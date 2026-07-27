import type { GlossToken } from '@slb/core';
import type { Segment } from '../segmenter';
import type { SignRecognizer } from './types';
import { HAND_POINTS } from '../keypoints';

/**
 * ⚠️ THIS IS NOT SIGN LANGUAGE RECOGNITION. ⚠️
 *
 * It is a handful of geometric heuristics — count the extended fingers, check
 * whether a fingertip is near the chest — that exist so the end-to-end pipeline
 * (camera → keypoints → segmentation → gloss → assembly → delivery) can be run
 * and debugged before any model exists. It recognises about six configurations
 * under good lighting from a cooperative user.
 *
 * ASL is not a set of hand shapes. It has grammar carried in movement, in
 * space, and in the face; two signs with identical handshapes can differ only
 * in a facial marker. Nothing in this file engages with any of that, and no
 * amount of adding rules would. Real recognition is M3/M4 in PLAN.md §6, needs
 * trained weights, and needs the signer-independent evaluation in §8 before
 * anyone should trust a word of its output.
 *
 * The UI is required to display the "demo heuristics" warning whenever this
 * recogniser is the active one. Do not remove that warning, and do not present
 * this as an ASL feature.
 */
export class DemoGestureRecognizer implements SignRecognizer {
  readonly id = 'demo-heuristics';
  readonly kind = 'demo' as const;
  readonly description =
    'Geometric hand-shape heuristics. A scaffold for testing the pipeline — not sign language recognition.';
  readonly vocabulary = ['ME', 'HELLO', 'YES', 'STOP', 'NUM:1', 'NUM:2', 'NUM:3', 'NUM:4', 'NUM:5'];

  async init(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  dispose(): void {}

  async recognise(segment: Segment): Promise<GlossToken | null> {
    const frames = segment.frames.filter((f) => f.left || f.right);
    if (frames.length < 3) return null;

    // Judge the shape from the middle of the segment, where the hand is most
    // likely to be held rather than travelling into or out of position.
    const mid = frames[Math.floor(frames.length / 2)]!;
    const hand = mid.right ?? mid.left;
    if (!hand) return null;

    const fingers = extendedFingers(hand);
    const count = fingers.filter(Boolean).length;
    const lateral = lateralOscillation(segment);
    const wristY = hand[1]!;

    const emit = (gloss: string, confidence: number): GlossToken => ({
      gloss,
      // Capped well below 1: these are heuristics and should never look
      // authoritative next to a calibrated model's output.
      confidence: Math.min(confidence, 0.82),
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    });

    // Open hand held above the shoulder line, moving side to side.
    if (count === 5 && wristY < -0.2 && lateral > 0.08) return emit('HELLO', 0.78);

    // Open hand, held still, pushed away from the body.
    if (count === 5 && lateral < 0.03) return emit('STOP', 0.7);

    // Index finger pointing back at the chest.
    if (count === 1 && fingers[1] && nearChest(hand)) return emit('ME', 0.75);

    // Closed fist with vertical oscillation.
    if (count === 0 && verticalOscillation(segment) > 0.05) return emit('YES', 0.72);

    if (count >= 1 && count <= 5) return emit(`NUM:${count}`, 0.68);

    return null;
  }
}

/**
 * A finger is "extended" when its tip is further from the wrist than its
 * middle joint. Crude, and it fails on hands angled towards the camera, which
 * is a fair illustration of why real recognition needs a trained model.
 */
function extendedFingers(hand: Float32Array): boolean[] {
  const p = (i: number): [number, number] => [hand[i * 3]!, hand[i * 3 + 1]!];
  const [wx, wy] = p(0);
  const dist = (i: number): number => {
    const [x, y] = p(i);
    return Math.hypot(x - wx, y - wy);
  };
  // tip / pip landmark indices for thumb, index, middle, ring, pinky
  const joints: Array<[number, number]> = [
    [4, 2],
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];
  return joints.map(([tip, pip]) => {
    if (tip >= HAND_POINTS || pip >= HAND_POINTS) return false;
    return dist(tip) > dist(pip) * 1.15;
  });
}

/** Index fingertip close to the shoulder-midpoint origin, i.e. the chest. */
function nearChest(hand: Float32Array): boolean {
  const x = hand[8 * 3]!;
  const y = hand[8 * 3 + 1]!;
  return Math.hypot(x, y) < 0.6;
}

function lateralOscillation(seg: Segment): number {
  return oscillation(seg, 0);
}

function verticalOscillation(seg: Segment): number {
  return oscillation(seg, 1);
}

/** Peak-to-peak wrist travel along one axis, in shoulder-width units. */
function oscillation(seg: Segment, axis: 0 | 1): number {
  let min = Infinity;
  let max = -Infinity;
  for (const f of seg.frames) {
    const hand = f.right ?? f.left;
    if (!hand) continue;
    const v = hand[axis]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}
