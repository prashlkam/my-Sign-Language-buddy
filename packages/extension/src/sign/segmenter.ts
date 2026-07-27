import type { FrameKeypoints } from './keypoints';

/**
 * Signing-activity segmentation (PLAN.md §4.2).
 *
 * This is where false positives come from, and false positives are the failure
 * users hate most: text they never meant to say, spoken aloud to their
 * colleagues. Scratching your nose, adjusting your glasses, picking up a mug —
 * all of it looks like hand motion.
 *
 * So the design is deliberately conservative:
 *   - hysteresis in both directions (a burst of motion is not an utterance,
 *     and a brief pause mid-sign is not the end of one),
 *   - a minimum duration below which a segment is discarded entirely,
 *   - and, by default, a hotkey gate on top of all of it, because "the machine
 *     decides when you are talking" is a bad deal when it is wrong.
 */

export interface SegmenterOptions {
  /** Normalised motion energy above which a frame counts as active. */
  activityThreshold?: number;
  /** Consecutive active frames needed to open a segment. */
  framesToStart?: number;
  /** Consecutive idle frames needed to close one. */
  framesToStop?: number;
  /** Segments shorter than this are noise, not utterances. */
  minSegmentMs?: number;
  /** Hard cap so a stuck segment can't grow without bound. */
  maxSegmentMs?: number;
}

export interface Segment {
  frames: FrameKeypoints[];
  startedAt: number;
  endedAt: number;
}

export type SegmenterState = 'idle' | 'signing';

export class SigningSegmenter {
  private readonly activityThreshold: number;
  private readonly framesToStart: number;
  private readonly framesToStop: number;
  private readonly minSegmentMs: number;
  private readonly maxSegmentMs: number;

  private state: SegmenterState = 'idle';
  private activeRun = 0;
  private idleRun = 0;
  private buffer: FrameKeypoints[] = [];
  private prev: FrameKeypoints | null = null;
  private lastEnergy = 0;

  constructor(opts: SegmenterOptions = {}) {
    this.activityThreshold = opts.activityThreshold ?? 0.035;
    this.framesToStart = opts.framesToStart ?? 4;
    this.framesToStop = opts.framesToStop ?? 12;
    this.minSegmentMs = opts.minSegmentMs ?? 400;
    this.maxSegmentMs = opts.maxSegmentMs ?? 8000;
  }

  getState(): SegmenterState {
    return this.state;
  }

  /** 0..1-ish motion energy, exposed so the UI can show a live activity meter. */
  getEnergy(): number {
    return this.lastEnergy;
  }

  /**
   * Feed one frame. Returns a completed segment on the frame that closes it.
   */
  push(frame: FrameKeypoints): Segment | null {
    const energy = this.motionEnergy(frame);
    this.lastEnergy = energy;
    this.prev = frame;

    const active = energy > this.activityThreshold && (frame.left !== null || frame.right !== null);

    if (active) {
      this.activeRun++;
      this.idleRun = 0;
    } else {
      this.idleRun++;
      this.activeRun = 0;
    }

    if (this.state === 'idle') {
      // Keep a short rolling pre-roll so the start of a sign isn't clipped by
      // the frames it takes to notice motion has begun.
      this.buffer.push(frame);
      if (this.buffer.length > this.framesToStart * 2) this.buffer.shift();

      if (this.activeRun >= this.framesToStart) {
        this.state = 'signing';
      }
      return null;
    }

    this.buffer.push(frame);
    const startedAt = this.buffer[0]?.t ?? frame.t;
    const tooLong = frame.t - startedAt > this.maxSegmentMs;

    if (this.idleRun >= this.framesToStop || tooLong) {
      return this.close(frame.t);
    }
    return null;
  }

  /** Force the current segment closed — used when the hotkey is released. */
  flush(now = performance.now()): Segment | null {
    if (this.state !== 'signing') {
      this.buffer = [];
      return null;
    }
    return this.close(now);
  }

  reset(): void {
    this.state = 'idle';
    this.buffer = [];
    this.prev = null;
    this.activeRun = 0;
    this.idleRun = 0;
  }

  private close(endedAt: number): Segment | null {
    const frames = this.buffer;
    this.buffer = [];
    this.state = 'idle';
    this.activeRun = 0;
    this.idleRun = 0;

    const startedAt = frames[0]?.t ?? endedAt;
    if (frames.length === 0 || endedAt - startedAt < this.minSegmentMs) {
      return null;
    }
    return { frames, startedAt, endedAt };
  }

  /**
   * Mean per-landmark displacement of the hands between consecutive frames,
   * in shoulder-width units. Pose motion is ignored: leaning back in a chair
   * moves every body landmark and none of it is signing.
   */
  private motionEnergy(frame: FrameKeypoints): number {
    const prev = this.prev;
    if (!prev) return 0;

    let sum = 0;
    let n = 0;
    for (const side of ['left', 'right'] as const) {
      const a = prev[side];
      const b = frame[side];
      if (!a || !b || a.length !== b.length) continue;
      for (let i = 0; i < a.length; i += 3) {
        sum += Math.hypot(b[i]! - a[i]!, b[i + 1]! - a[i + 1]!);
        n++;
      }
    }
    return n === 0 ? 0 : sum / n;
  }
}
