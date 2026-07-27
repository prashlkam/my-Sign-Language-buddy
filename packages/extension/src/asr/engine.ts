/**
 * ASR engine seam (PLAN.md §4.4).
 *
 * Engines emit *whole-utterance hypotheses*, not deltas. Turning a sequence of
 * revised hypotheses into append-only caption text is the job of
 * StablePrefixCommitter in @slb/core, and doing it in one place means every
 * engine gets the same non-flickering behaviour.
 */

export interface AsrCallbacks {
  /** A revised best-guess for the current utterance. May change again. */
  onPartial: (text: string, utteranceStartedAt: number) => void;
  /** The utterance is closed. Will not change. */
  onFinal: (text: string, utteranceStartedAt: number, confidence: number | null) => void;
  onState: (state: AsrState) => void;
}

export interface AsrState {
  running: boolean;
  engine: string;
  /** Where the audio is processed. Shown to the user verbatim — see §10. */
  processing: 'on-device' | 'cloud-google' | 'local-helper';
  /** What the engine is listening to. The two are not interchangeable. */
  listeningTo: 'microphone' | 'call-audio';
  error?: string;
}

export interface AsrEngine {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
