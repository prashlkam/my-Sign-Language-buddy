#!/usr/bin/env python3
"""
Sign Language Buddy — desktop helper (reference implementation).

The extension can capture the call's audio but cannot transcribe it locally:
a browser has no way to run faster-whisper. This helper closes that gap. It
listens on loopback only, accepts 16 kHz PCM16 frames from the extension's
offscreen document, and streams back transcripts.

Audio never leaves this machine.

Protocol: packages/core/src/protocol.ts (keep the two in step — the version
number is checked on connect).

    pip install -r requirements.txt
    python helper.py

⚠ STATUS: this file implements the protocol and the streaming policy, but it
has not been run end to end against the extension in a real call. Treat it as
a starting point to debug from, not as a tested component. The parts most
likely to need adjustment are the endpointing thresholds in `Session` — they
are guesses that want tuning against real meeting audio.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass, field

import numpy as np
import websockets
from websockets.server import WebSocketServerProtocol

PROTOCOL_VERSION = 1
SAMPLE_RATE = 16_000

log = logging.getLogger("slb-helper")


@dataclass
class Config:
    port: int = 8757
    token: str = ""
    model: str = "large-v3-turbo"
    compute_type: str = "int8"
    device: str = "auto"
    language: str | None = "en"
    # How often we re-decode the open utterance. Lower = lower latency, more CPU.
    decode_interval_s: float = 0.6
    # Silence long enough to call the utterance finished.
    endpoint_silence_s: float = 0.8
    # RMS below this counts as silence. Depends on the capture chain; tune it.
    silence_rms: float = 0.006
    # Hard cap so one long monologue doesn't grow the decode window forever.
    max_utterance_s: float = 25.0


@dataclass
class Session:
    """One connected extension. Owns the audio buffer for the open utterance."""

    config: Config
    audio: list[np.ndarray] = field(default_factory=list)
    samples: int = 0
    last_voice_at: float = field(default_factory=time.monotonic)
    last_decode_at: float = 0.0
    started_at: float = field(default_factory=time.monotonic)
    open_utterance: bool = False

    def add(self, pcm: np.ndarray) -> None:
        self.audio.append(pcm)
        self.samples += len(pcm)
        if rms(pcm) > self.config.silence_rms:
            self.last_voice_at = time.monotonic()
            if not self.open_utterance:
                self.open_utterance = True
                self.started_at = time.monotonic()

    def waveform(self) -> np.ndarray:
        return np.concatenate(self.audio) if self.audio else np.zeros(0, dtype=np.float32)

    def duration_s(self) -> float:
        return self.samples / SAMPLE_RATE

    def should_decode(self) -> bool:
        if not self.open_utterance or self.duration_s() < 0.4:
            return False
        return time.monotonic() - self.last_decode_at >= self.config.decode_interval_s

    def should_endpoint(self) -> bool:
        if not self.open_utterance:
            return False
        silent_for = time.monotonic() - self.last_voice_at
        return (
            silent_for >= self.config.endpoint_silence_s
            or self.duration_s() >= self.config.max_utterance_s
        )

    def reset(self) -> None:
        self.audio.clear()
        self.samples = 0
        self.open_utterance = False
        self.started_at = time.monotonic()


def rms(pcm: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(pcm)))) if len(pcm) else 0.0


class Transcriber:
    """Thin wrapper so the model is loaded once and decoded off the event loop."""

    def __init__(self, config: Config) -> None:
        from faster_whisper import WhisperModel  # imported late: slow and heavy

        log.info("loading %s (%s)…", config.model, config.compute_type)
        self.model = WhisperModel(
            config.model, device=config.device, compute_type=config.compute_type
        )
        self.config = config
        log.info("model ready")

    def transcribe(self, waveform: np.ndarray) -> str:
        segments, _info = self.model.transcribe(
            waveform,
            language=self.config.language,
            beam_size=1,  # greedy: this is a latency-bound path
            vad_filter=False,  # we do our own endpointing
            condition_on_previous_text=False,  # stops the model inventing continuations
        )
        return " ".join(s.text.strip() for s in segments).strip()


async def send(ws: WebSocketServerProtocol, payload: dict) -> None:
    await ws.send(json.dumps(payload))


async def handle(ws: WebSocketServerProtocol, config: Config, transcriber: Transcriber) -> None:
    session = Session(config=config)
    authorised = not config.token  # an empty configured token disables auth
    loop = asyncio.get_running_loop()
    utterance_started_ms = time.time() * 1000

    async for message in ws:
        if isinstance(message, bytes):
            if not authorised:
                continue
            # PCM16 little-endian → float32 in [-1, 1].
            pcm = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
            if not session.open_utterance:
                utterance_started_ms = time.time() * 1000
            session.add(pcm)

            if session.should_endpoint():
                text = await loop.run_in_executor(
                    None, transcriber.transcribe, session.waveform()
                )
                if text:
                    await send(
                        ws,
                        {
                            "type": "asr.final",
                            "text": text,
                            "utteranceStartedAt": utterance_started_ms,
                            "confidence": None,
                        },
                    )
                session.reset()

            elif session.should_decode():
                session.last_decode_at = time.monotonic()
                text = await loop.run_in_executor(
                    None, transcriber.transcribe, session.waveform()
                )
                if text:
                    # The extension applies the stable-prefix policy; we always
                    # send our current best guess for the whole utterance.
                    await send(
                        ws,
                        {
                            "type": "asr.partial",
                            "text": text,
                            "utteranceStartedAt": utterance_started_ms,
                        },
                    )
            continue

        try:
            msg = json.loads(message)
        except json.JSONDecodeError:
            continue

        kind = msg.get("type")
        if kind == "hello":
            if msg.get("version") != PROTOCOL_VERSION:
                await send(
                    ws,
                    {
                        "type": "error",
                        "code": "version-mismatch",
                        "message": f"Helper speaks protocol v{PROTOCOL_VERSION}; "
                        f"the extension sent v{msg.get('version')}. Update one of them.",
                    },
                )
                await ws.close()
                return
            if config.token and not secrets.compare_digest(msg.get("token", ""), config.token):
                await send(
                    ws,
                    {"type": "error", "code": "unauthorized", "message": "Bad token."},
                )
                await ws.close()
                return
            authorised = True
            await send(
                ws,
                {
                    "type": "hello.ok",
                    "version": PROTOCOL_VERSION,
                    "capabilities": {
                        "asr": True,
                        # Not implemented here. A virtual mic/cam needs
                        # platform-specific plumbing (PipeWire, v4l2loopback,
                        # OBS VirtualCam) — see PLAN.md §6 M2.
                        "virtualMic": False,
                        "virtualCam": False,
                        "asrModel": config.model,
                    },
                },
            )
        elif kind == "asr.stop":
            session.reset()
        elif kind == "ping":
            await send(ws, {"type": "pong", "at": msg.get("at", 0)})


async def main() -> None:
    parser = argparse.ArgumentParser(description="Sign Language Buddy desktop helper")
    parser.add_argument("--port", type=int, default=8757)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--language", default="en")
    parser.add_argument(
        "--no-auth",
        action="store_true",
        help="Skip token auth. Loopback only, but still not recommended.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    token = "" if args.no_auth else secrets.token_urlsafe(18)
    config = Config(
        port=args.port,
        token=token,
        model=args.model,
        compute_type=args.compute_type,
        device=args.device,
        language=args.language,
    )

    transcriber = Transcriber(config)

    if token:
        print("\n" + "=" * 62)
        print("  Paste this token into the extension's settings:\n")
        print(f"      {token}\n")
        print("=" * 62 + "\n")

    async def handler(ws: WebSocketServerProtocol) -> None:
        log.info("extension connected")
        try:
            await handle(ws, config, transcriber)
        except websockets.ConnectionClosed:
            pass
        finally:
            log.info("extension disconnected")

    # 127.0.0.1 only. This must never bind a routable interface: it would put a
    # live microphone feed of the user's meetings on the network.
    async with websockets.serve(handler, "127.0.0.1", config.port, max_size=2**20):
        log.info("listening on ws://127.0.0.1:%d", config.port)
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
