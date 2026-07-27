import type { Caption, CaptionSource, Participant } from './types';

export interface CaptionEngineOptions {
  /** Ring buffer size. In-memory only — nothing is persisted (PLAN.md §10). */
  maxCaptions?: number;
  /**
   * An utterance from the same speaker that resumes within this window is
   * merged into the previous line rather than starting a new one, so captions
   * don't fragment on natural pauses.
   */
  mergeWindowMs?: number;
}

type Listener = (captions: readonly Caption[]) => void;

/**
 * Holds the caption history and decides how incoming text becomes lines.
 *
 * Deliberately dumb about rendering and deliberately strict about mutation:
 * a caption that has been committed (interim === false) is never edited again,
 * because the user may already have read it.
 */
export class CaptionEngine {
  private captions: Caption[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;
  private readonly maxCaptions: number;
  private readonly mergeWindowMs: number;

  constructor(opts: CaptionEngineOptions = {}) {
    this.maxCaptions = opts.maxCaptions ?? 500;
    this.mergeWindowMs = opts.mergeWindowMs ?? 2500;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): readonly Caption[] {
    return this.captions;
  }

  /**
   * Update the live, still-changing line for a source/speaker pair. Replaces
   * the previous interim line rather than appending.
   */
  upsertInterim(args: {
    source: CaptionSource;
    speaker: Participant | null;
    text: string;
    confidence?: number | null;
    startedAt: number;
  }): void {
    const existing = this.findOpenInterim(args.source, args.speaker);
    if (existing) {
      existing.text = args.text;
      existing.confidence = args.confidence ?? existing.confidence;
      existing.producedAt = now();
    } else {
      if (args.text.trim() === '') return;
      this.captions.push({
        id: `c${++this.seq}`,
        source: args.source,
        speaker: args.speaker,
        text: args.text,
        interim: true,
        confidence: args.confidence ?? null,
        startedAt: args.startedAt,
        producedAt: now(),
      });
      this.trim();
    }
    this.emit();
  }

  /**
   * Commit text permanently. Merges into the trailing line if it is the same
   * speaker and source and is recent enough.
   */
  commit(args: {
    source: CaptionSource;
    speaker: Participant | null;
    text: string;
    confidence?: number | null;
    startedAt: number;
  }): Caption | null {
    const text = args.text.trim();
    const interim = this.findOpenInterim(args.source, args.speaker);
    if (interim) {
      this.captions = this.captions.filter((c) => c !== interim);
    }
    if (text === '') {
      if (interim) this.emit();
      return null;
    }

    const last = this.captions[this.captions.length - 1];
    if (
      last &&
      !last.interim &&
      last.source === args.source &&
      sameSpeaker(last.speaker, args.speaker) &&
      now() - last.producedAt < this.mergeWindowMs
    ) {
      last.text = `${last.text} ${text}`.trim();
      last.producedAt = now();
      last.confidence = minConfidence(last.confidence, args.confidence ?? null);
      this.emit();
      return last;
    }

    const caption: Caption = {
      id: `c${++this.seq}`,
      source: args.source,
      speaker: args.speaker,
      text,
      interim: false,
      confidence: args.confidence ?? null,
      startedAt: args.startedAt,
      producedAt: now(),
    };
    this.captions.push(caption);
    this.trim();
    this.emit();
    return caption;
  }

  /** Non-speech notice (errors, camera coaching). Always committed. */
  system(text: string): void {
    this.commit({ source: 'system', speaker: null, text, startedAt: now() });
  }

  clear(): void {
    this.captions = [];
    this.emit();
  }

  private findOpenInterim(source: CaptionSource, speaker: Participant | null): Caption | undefined {
    for (let i = this.captions.length - 1; i >= 0; i--) {
      const c = this.captions[i]!;
      if (!c.interim) continue;
      if (c.source === source && sameSpeaker(c.speaker, speaker)) return c;
    }
    return undefined;
  }

  private trim(): void {
    if (this.captions.length > this.maxCaptions) {
      this.captions.splice(0, this.captions.length - this.maxCaptions);
    }
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }
}

function sameSpeaker(a: Participant | null, b: Participant | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.id === b.id;
}

function minConfidence(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
