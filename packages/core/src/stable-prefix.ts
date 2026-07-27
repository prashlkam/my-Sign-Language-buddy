/**
 * Stable-prefix commit policy for streaming ASR (PLAN.md §4.4).
 *
 * Streaming ASR revises its own output constantly. Rendering every hypothesis
 * verbatim produces captions that flicker and rewrite themselves mid-word,
 * which is exhausting to read and is the single most common way streaming
 * caption UIs fail their users.
 *
 * The fix is "local agreement-n" (as used by whisper-streaming): a word is
 * committed only once the last N hypotheses have all agreed on it. Committed
 * text is append-only and never mutates. Everything after the commit point is
 * shown as a visually distinct draft that the reader knows may still change.
 *
 * Tuning: n=2 is the right default. n=1 flickers; n=3 adds a decode interval of
 * latency for very little extra stability.
 */

export interface CommitResult {
  /** Words committed by this push. Append-only; safe to render permanently. */
  newlyCommitted: string;
  /** Full committed text so far. */
  committed: string;
  /** Unstable tail. Render distinctly (lower contrast / italic). */
  draft: string;
}

function words(s: string): string[] {
  return s.trim().length === 0 ? [] : s.trim().split(/\s+/);
}

function commonPrefixLength(lists: string[][]): number {
  if (lists.length === 0) return 0;
  const shortest = Math.min(...lists.map((l) => l.length));
  let i = 0;
  for (; i < shortest; i++) {
    const w = lists[0]![i]!;
    if (!lists.every((l) => l[i] === w)) break;
  }
  return i;
}

export class StablePrefixCommitter {
  private committedWords: string[] = [];
  /** The last (n-1) hypotheses, oldest first. */
  private history: string[][] = [];
  /**
   * Counts hypotheses that contradicted already-committed text. Non-zero means
   * the ASR is revising history — surfaced in diagnostics, not to the user.
   */
  private divergences = 0;

  constructor(private readonly agreement: number = 2) {
    if (agreement < 1) throw new Error('agreement must be >= 1');
  }

  /**
   * @param hypothesis The ASR's current best transcript for the *whole* active
   *   utterance (not just the newest chunk).
   */
  push(hypothesis: string): CommitResult {
    const hyp = words(hypothesis);

    // The ASR is expected to keep re-emitting text we have already committed.
    // If it revises that text instead, we keep what the user already read —
    // rewriting history is worse than a small inconsistency — and re-anchor.
    let tail: string[];
    if (this.startsWithCommitted(hyp)) {
      tail = hyp.slice(this.committedWords.length);
    } else {
      this.divergences++;
      tail = hyp.slice(Math.min(this.committedWords.length, hyp.length));
    }

    this.history.push(tail);
    while (this.history.length > this.agreement) this.history.shift();

    let newlyCommitted: string[] = [];
    if (this.history.length === this.agreement) {
      const stable = commonPrefixLength(this.history);
      if (stable > 0) {
        newlyCommitted = tail.slice(0, stable);
        this.committedWords.push(...newlyCommitted);
        // Everything we just committed is dropped from the pending history so
        // the next comparison starts after the commit point.
        this.history = this.history.map((h) => h.slice(stable));
      }
    }

    return {
      newlyCommitted: newlyCommitted.join(' '),
      committed: this.committedWords.join(' '),
      draft: this.history.length > 0 ? this.history[this.history.length - 1]!.join(' ') : '',
    };
  }

  /**
   * Endpoint reached (silence, or the ASR declared the segment final): commit
   * the remaining draft unconditionally and reset for the next utterance.
   */
  finalize(finalText?: string): CommitResult {
    if (finalText !== undefined) {
      const f = words(finalText);
      this.committedWords = this.startsWithCommitted(f)
        ? f
        : [...this.committedWords, ...f.slice(Math.min(this.committedWords.length, f.length))];
    } else if (this.history.length > 0) {
      this.committedWords.push(...this.history[this.history.length - 1]!);
    }
    const committed = this.committedWords.join(' ');
    this.reset();
    return { newlyCommitted: committed, committed, draft: '' };
  }

  reset(): void {
    this.committedWords = [];
    this.history = [];
  }

  get diagnostics(): { divergences: number; committedWordCount: number } {
    return { divergences: this.divergences, committedWordCount: this.committedWords.length };
  }

  private startsWithCommitted(hyp: string[]): boolean {
    if (hyp.length < this.committedWords.length) return false;
    return this.committedWords.every((w, i) => hyp[i] === w);
  }
}
