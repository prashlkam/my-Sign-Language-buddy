import type { AsrCallbacks, AsrEngine } from './engine';

/**
 * Web Speech API engine.
 *
 * Two things about this engine are easy to get wrong, and both are disclosed to
 * the user rather than buried:
 *
 * 1. IT IS NOT ON-DEVICE. Chrome streams the audio to Google's servers for
 *    recognition. PLAN.md §10 promises that nothing leaves the device by
 *    default — this engine is an exception to that promise, so the UI labels it
 *    "Cloud (Google)" whenever it is running, and onboarding says so plainly.
 *
 * 2. IT LISTENS TO THE MICROPHONE, not to the other participants. The browser
 *    gives no way to point Web Speech at a captured tab stream. So on its own
 *    it captions *the local user's* voice, which is the wrong direction for a
 *    Deaf user who wants to read what others are saying. It becomes useful for
 *    that only if call audio is routed into the microphone with a system
 *    loopback device.
 *
 * It is included because it needs no install and gives an immediately working
 * demo. The desktop helper (see helper.ts) is the engine that actually delivers
 * the product promise: local processing, of the call's audio.
 */
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    length: number;
    0: { transcript: string; confidence: number };
  }>;
}

function ctor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechAvailable(): boolean {
  return ctor() !== null;
}

export class WebSpeechEngine implements AsrEngine {
  readonly name = 'web-speech';

  private rec: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private utteranceStartedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly cb: AsrCallbacks,
    private readonly language: string | null,
  ) {}

  async start(): Promise<void> {
    const C = ctor();
    if (!C) {
      this.cb.onState({
        running: false,
        engine: this.name,
        processing: 'cloud-google',
        listeningTo: 'microphone',
        error: 'This browser has no Web Speech support. Use the desktop helper instead.',
      });
      return;
    }

    this.wantRunning = true;
    this.spawn(C);
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.rec?.abort();
    this.rec = null;
    this.emitState(false);
  }

  private spawn(C: SpeechRecognitionCtor): void {
    const rec = new C();
    this.rec = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = this.language ?? navigator.language ?? 'en-US';

    rec.onstart = () => {
      this.consecutiveFailures = 0;
      this.utteranceStartedAt = performance.now();
      this.emitState(true);
    };

    rec.onresult = (ev) => {
      // Chrome re-delivers the whole result list; we only care about entries
      // from resultIndex onward, and we concatenate them into one hypothesis
      // for the active utterance.
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        const alt = r[0];
        if (r.isFinal) {
          this.cb.onFinal(alt.transcript.trim(), this.utteranceStartedAt, alt.confidence ?? null);
          this.utteranceStartedAt = performance.now();
        } else {
          interim += alt.transcript;
        }
      }
      if (interim.trim() !== '') {
        this.cb.onPartial(interim.trim(), this.utteranceStartedAt);
      }
    };

    rec.onerror = (ev) => {
      // 'no-speech' and 'aborted' are routine; everything else is worth saying.
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      this.consecutiveFailures++;
      this.emitState(this.wantRunning, describeError(ev.error));
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        this.wantRunning = false;
      }
    };

    rec.onend = () => {
      // Chrome ends the session on silence even in continuous mode. Restart it,
      // with backoff so a hard failure doesn't become a hot loop.
      if (!this.wantRunning) {
        this.emitState(false);
        return;
      }
      const delay = Math.min(500 * 2 ** this.consecutiveFailures, 15_000);
      this.restartTimer = setTimeout(() => {
        if (this.wantRunning) this.spawn(C);
      }, delay);
    };

    try {
      rec.start();
    } catch (err) {
      // start() throws if a session is already live; the onend handler will retry.
      this.emitState(this.wantRunning, err instanceof Error ? err.message : String(err));
    }
  }

  private emitState(running: boolean, error?: string): void {
    this.cb.onState({
      running,
      engine: this.name,
      processing: 'cloud-google',
      listeningTo: 'microphone',
      ...(error ? { error } : {}),
    });
  }
}

function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone access was denied. Allow it for this site to use speech captions.';
    case 'service-not-allowed':
      return 'Speech recognition is blocked by browser policy on this device.';
    case 'network':
      return 'Speech recognition lost its network connection (this engine is cloud-based).';
    case 'audio-capture':
      return 'No microphone was found.';
    default:
      return `Speech recognition error: ${code}`;
  }
}
