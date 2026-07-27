import { helperUrl, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@slb/core';

/**
 * Offscreen audio worker.
 *
 * Owns three things that have nowhere else to live in MV3:
 *   1. the captured tab audio stream,
 *   2. the AudioContext + worklet that turn it into 16 kHz PCM16,
 *   3. the loopback WebSocket to the desktop helper.
 *
 * Keeping the socket here rather than in the service worker matters: audio
 * frames would otherwise have to cross chrome.runtime messaging, which
 * JSON-serialises typed arrays into objects with numeric keys — roughly a 10×
 * size blowup on the hottest path in the app. Here the bytes go straight from
 * the worklet to the socket.
 *
 * The audio also has to be played back locally. chrome.tabCapture mutes the tab
 * for the user while it is captured, so without the passthrough below the call
 * would go silent for anyone with residual hearing.
 */

interface StartMessage {
  target: 'offscreen';
  type: 'start';
  streamId: string;
  port: number;
  token: string;
  language: string | null;
}

interface StopMessage {
  target: 'offscreen';
  type: 'stop';
}

type OffscreenMessage = StartMessage | StopMessage;

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let socket: WebSocket | null = null;
let utteranceStartedAt = 0;

function toBackground(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {
    // The service worker may be asleep; it will re-ask for state when it wakes.
  });
}

function send(msg: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function start(msg: StartMessage): Promise<void> {
  await stop();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error — Chrome-specific tab capture constraints.
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId },
      },
      video: false,
    });
  } catch (err) {
    toBackground({
      type: 'asr/state',
      running: false,
      error: `Could not capture the call's audio: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // 16 kHz directly, so the browser does the resampling and the worklet only
  // has to change the sample format.
  ctx = new AudioContext({ sampleRate: 16_000 });
  const source = ctx.createMediaStreamSource(stream);

  // Give the user their audio back — capturing it mutes the tab.
  source.connect(ctx.destination);

  try {
    await ctx.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
  } catch (err) {
    toBackground({
      type: 'asr/state',
      running: false,
      error: `Audio worklet failed to load: ${err instanceof Error ? err.message : String(err)}`,
    });
    await stop();
    return;
  }

  const node = new AudioWorkletNode(ctx, 'pcm-worklet');
  node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(ev.data);
  };
  source.connect(node);
  // Worklets are only pulled if they reach the destination, but we must not
  // hear the PCM tap itself — a zero-gain sink keeps it running silently.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  node.connect(silent).connect(ctx.destination);

  openSocket(msg);
}

function openSocket(msg: StartMessage): void {
  const url = helperUrl(msg.port);
  socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';

  socket.onopen = () => {
    send({ type: 'hello', version: PROTOCOL_VERSION, token: msg.token });
    send({ type: 'asr.format', encoding: 'pcm16', sampleRate: 16_000, channels: 1 });
    send({ type: 'asr.start', sampleRate: 16_000, language: msg.language });
    utteranceStartedAt = performance.now();
    toBackground({ type: 'asr/state', running: true });
  };

  socket.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(ev.data) as ServerMessage;
    } catch {
      return;
    }

    switch (parsed.type) {
      case 'asr.partial':
        toBackground({ type: 'asr/partial', text: parsed.text, utteranceStartedAt });
        break;
      case 'asr.final':
        toBackground({
          type: 'asr/final',
          text: parsed.text,
          utteranceStartedAt,
          confidence: parsed.confidence,
        });
        utteranceStartedAt = performance.now();
        break;
      case 'error':
        toBackground({ type: 'asr/state', running: false, error: parsed.message });
        break;
      case 'hello.ok':
        if (!parsed.capabilities.asr) {
          toBackground({
            type: 'asr/state',
            running: false,
            error: 'The desktop helper is running but has no speech model loaded.',
          });
        }
        break;
      default:
        break;
    }
  };

  socket.onerror = () => {
    toBackground({
      type: 'asr/state',
      running: false,
      error:
        `Could not reach the desktop helper on ${url}. ` +
        'Start it, or switch the speech engine to Web Speech in settings.',
    });
  };

  socket.onclose = () => {
    toBackground({ type: 'asr/state', running: false });
  };
}

async function stop(): Promise<void> {
  send({ type: 'asr.stop' });
  socket?.close();
  socket = null;

  stream?.getTracks().forEach((t) => t.stop());
  stream = null;

  await ctx?.close().catch(() => undefined);
  ctx = null;
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as OffscreenMessage;
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'start') void start(msg);
  if (msg.type === 'stop') void stop();
});
