import type { GlossToken } from '@slb/core';
import type { Segment } from '../segmenter';

/**
 * A recogniser turns a segment of keypoints into at most one gloss.
 *
 * `null` is a first-class, expected return value. A recogniser that always
 * produces an answer is worse than one that abstains, because the cost of a
 * confident wrong sign is words in someone's mouth (PLAN.md §4.2).
 */
export interface SignRecognizer {
  readonly id: string;
  /**
   * `demo` means heuristics, not machine learning, and NOT sign language
   * recognition. The UI must say so whenever a demo recogniser is active.
   */
  readonly kind: 'demo' | 'onnx';
  readonly vocabulary: readonly string[];
  /** Human-readable, shown in settings and diagnostics. */
  readonly description: string;

  init(): Promise<{ ok: boolean; error?: string }>;
  recognise(segment: Segment): Promise<GlossToken | null>;
  dispose(): void;
}
