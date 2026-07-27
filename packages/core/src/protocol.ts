/**
 * Wire protocol between the extension and the optional desktop helper
 * (PLAN.md §5, §10). Loopback WebSocket only, token-authenticated.
 *
 * The helper exists because a browser extension cannot capture system audio,
 * cannot open a virtual microphone, and cannot run faster-whisper. Everything
 * that needs the OS lives there; everything else stays in the extension so that
 * Meet-only users can run with no install.
 *
 * Audio frames are 16 kHz mono PCM16. They stay on the loopback interface.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_HELPER_PORT = 8757;

export type ClientMessage =
  | { type: 'hello'; version: number; token: string }
  | { type: 'asr.start'; sampleRate: number; language: string | null }
  | { type: 'asr.stop' }
  /** PCM16 frames are sent as binary, not JSON — this announces the format. */
  | { type: 'asr.format'; encoding: 'pcm16'; sampleRate: number; channels: 1 }
  | { type: 'tts.speak'; text: string; voice: string | null; utteranceId: string }
  | { type: 'tts.cancel'; utteranceId: string }
  | { type: 'vcam.caption'; text: string; confidence: number }
  | { type: 'ping'; at: number };

export type ServerMessage =
  | { type: 'hello.ok'; version: number; capabilities: HelperCapabilities }
  | { type: 'error'; code: HelperErrorCode; message: string }
  | {
      type: 'asr.partial';
      /** Best transcript for the whole active utterance so far. */
      text: string;
      /** ms since epoch at which the first audio of this utterance was captured. */
      utteranceStartedAt: number;
    }
  | { type: 'asr.final'; text: string; utteranceStartedAt: number; confidence: number | null }
  | { type: 'tts.started'; utteranceId: string }
  | { type: 'tts.finished'; utteranceId: string }
  | { type: 'pong'; at: number };

export interface HelperCapabilities {
  asr: boolean;
  /** A virtual microphone is present, so TTS can be heard by the call. */
  virtualMic: boolean;
  /** A virtual camera is present, so captions can be burned into our video tile. */
  virtualCam: boolean;
  asrModel: string | null;
}

export type HelperErrorCode =
  | 'unauthorized'
  | 'version-mismatch'
  | 'asr-unavailable'
  | 'tts-unavailable'
  | 'device-unavailable'
  | 'internal';

export function helperUrl(port: number = DEFAULT_HELPER_PORT): string {
  return `ws://127.0.0.1:${port}/v${PROTOCOL_VERSION}`;
}
