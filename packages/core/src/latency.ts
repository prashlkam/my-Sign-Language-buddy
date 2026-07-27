/**
 * End-to-end latency instrumentation (PLAN.md §6 M0, §8).
 *
 * The number that matters is signal-in → pixel-on-screen, not model inference
 * time. Measuring inference alone is how latency budgets get blown: the decode
 * is fast and the queueing, the paint, and the platform round-trip are not.
 *
 * Targets (PLAN.md §1.2): speech→caption p50 < 800 ms / p95 < 1.5 s;
 * sign→delivered p50 < 2.0 s.
 */

export type Stage =
  | 'capture'      // audio frame captured / video frame grabbed
  | 'recognised'   // ASR hypothesis or sign gloss produced
  | 'assembled'    // gloss sequence turned into English
  | 'rendered'     // painted into the overlay
  | 'delivered';   // reached other participants

export interface Sample {
  stage: Stage;
  /** ms from the originating capture to this stage. */
  elapsedMs: number;
  at: number;
}

export interface StageStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export class LatencyTracker {
  private samples = new Map<Stage, number[]>();
  private readonly cap: number;

  constructor(cap = 2000) {
    this.cap = cap;
  }

  /**
   * @param capturedAt performance.now() at the moment the originating signal
   *   was captured. Pass it down the pipeline; do not re-stamp at each stage.
   */
  mark(stage: Stage, capturedAt: number): Sample {
    const now = performance.now();
    const elapsed = now - capturedAt;
    const arr = this.samples.get(stage) ?? [];
    arr.push(elapsed);
    if (arr.length > this.cap) arr.shift();
    this.samples.set(stage, arr);
    return { stage, elapsedMs: elapsed, at: now };
  }

  stats(stage: Stage): StageStats | null {
    const arr = this.samples.get(stage);
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted[sorted.length - 1]!,
    };
  }

  report(): Record<string, StageStats> {
    const out: Record<string, StageStats> = {};
    for (const stage of this.samples.keys()) {
      const s = this.stats(stage);
      if (s) out[stage] = s;
    }
    return out;
  }

  reset(): void {
    this.samples.clear();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/** Shared instance — one pipeline per page, so a module singleton is honest here. */
export const latency = new LatencyTracker();
