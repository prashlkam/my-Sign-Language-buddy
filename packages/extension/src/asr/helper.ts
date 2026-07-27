import type { AsrCallbacks, AsrEngine } from './engine';
import { sendToBackground } from '../messages';
import type { ToContent } from '../messages';

/**
 * The desktop-helper engine — the one that actually delivers the product
 * promise (PLAN.md §4.4, §10): the *call's* audio, transcribed *locally*.
 *
 * The content script only proxies. The real work is in the service worker,
 * which captures tab audio, hands it to an offscreen document for PCM
 * conversion, and streams it over a loopback WebSocket to the helper running
 * faster-whisper. Audio never leaves the machine.
 *
 * If the helper is not installed this engine reports that clearly instead of
 * failing quietly — a caption tool that silently shows nothing is worse than
 * one that says "I am not running".
 */
export class HelperEngine implements AsrEngine {
  readonly name = 'helper';

  private listener: ((msg: ToContent) => void) | null = null;

  constructor(private readonly cb: AsrCallbacks) {}

  async start(): Promise<void> {
    this.listener = (msg: ToContent) => {
      switch (msg.type) {
        case 'asr/partial':
          this.cb.onPartial(msg.text, msg.utteranceStartedAt);
          break;
        case 'asr/final':
          this.cb.onFinal(msg.text, msg.utteranceStartedAt, msg.confidence);
          break;
        case 'asr/state':
          this.cb.onState({
            running: msg.running,
            engine: this.name,
            processing: 'local-helper',
            listeningTo: 'call-audio',
            ...(msg.error ? { error: msg.error } : {}),
          });
          break;
        default:
          break;
      }
    };
    globalThis.chrome?.runtime?.onMessage?.addListener(this.listener);

    const res = await sendToBackground({ type: 'asr/start' });
    if (!res.ok) {
      this.cb.onState({
        running: false,
        engine: this.name,
        processing: 'local-helper',
        listeningTo: 'call-audio',
        error: res.error ?? 'Could not reach the desktop helper.',
      });
    }
  }

  async stop(): Promise<void> {
    if (this.listener) {
      globalThis.chrome?.runtime?.onMessage?.removeListener(this.listener);
      this.listener = null;
    }
    await sendToBackground({ type: 'asr/stop' });
    this.cb.onState({
      running: false,
      engine: this.name,
      processing: 'local-helper',
      listeningTo: 'call-audio',
    });
  }
}
