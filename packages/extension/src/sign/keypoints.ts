import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * Keypoint extraction (PLAN.md §4.1).
 *
 * We extract landmarks and immediately discard the pixels. That is a 10–50×
 * compute saving, it generalises across skin tone, lighting and background far
 * better than raw video would, and — the reason it is not merely an
 * optimisation — a stream of coordinates is not a face image. Nothing here can
 * be used to identify anyone, which is what makes the privacy claim in §10
 * something other than a promise.
 *
 * Normalisation puts the origin at the shoulder midpoint and scales by shoulder
 * width, so the representation is invariant to how far the user sits from the
 * camera and where they sit in frame. Without this, a model learns "distance
 * from webcam" as a feature and falls apart on anyone with a different desk.
 */

export const HAND_POINTS = 21;
export const POSE_POINTS = 33;
/** left(21×3) + right(21×3) + pose(33×3) */
export const FEATURES_PER_FRAME = (HAND_POINTS * 2 + POSE_POINTS) * 3;

export type FramingIssue =
  | 'no-person'
  | 'too-far'
  | 'too-close'
  | 'hands-out-of-frame'
  | 'hand-over-face';

export interface FrameKeypoints {
  /** performance.now() at capture. Carried through the pipeline for latency. */
  t: number;
  /** Normalised 21×3, or null when the hand is not visible. */
  left: Float32Array | null;
  right: Float32Array | null;
  pose: Float32Array | null;
  /** Framing problems worth telling the user about, rather than silently degrading. */
  issues: FramingIssue[];
}

export interface ExtractorStatus {
  ready: boolean;
  usingGpu: boolean;
  error?: string;
}

interface Landmark {
  x: number;
  y: number;
  z: number;
}

export class KeypointExtractor {
  private hands: HandLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private lastTimestamp = -1;
  private status: ExtractorStatus = { ready: false, usingGpu: false };

  getStatus(): ExtractorStatus {
    return this.status;
  }

  async init(): Promise<ExtractorStatus> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('wasm'));

      // GPU where available; CPU is a correctness-preserving fallback, just slower.
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          this.hands = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: chrome.runtime.getURL('models/hand_landmarker.task'),
              delegate,
            },
            numHands: 2,
            runningMode: 'VIDEO',
            minHandDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          this.pose = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: chrome.runtime.getURL('models/pose_landmarker_lite.task'),
              delegate,
            },
            numPoses: 1,
            runningMode: 'VIDEO',
          });
          this.status = { ready: true, usingGpu: delegate === 'GPU' };
          return this.status;
        } catch (err) {
          if (delegate === 'CPU') throw err;
        }
      }
      throw new Error('unreachable');
    } catch (err) {
      this.status = {
        ready: false,
        usingGpu: false,
        error:
          err instanceof Error && /model/i.test(err.message)
            ? 'Keypoint models are missing. Run `npm run fetch-models` and rebuild.'
            : `Could not start keypoint extraction: ${err instanceof Error ? err.message : String(err)}`,
      };
      return this.status;
    }
  }

  /**
   * @param timestampMs must increase monotonically — MediaPipe's VIDEO mode
   *   rejects out-of-order timestamps, and a dropped frame is better than a
   *   thrown exception mid-call.
   */
  extract(video: HTMLVideoElement, timestampMs: number): FrameKeypoints | null {
    if (!this.hands || !this.pose || !this.status.ready) return null;
    if (timestampMs <= this.lastTimestamp) return null;
    this.lastTimestamp = timestampMs;

    const t = performance.now();
    let handResult;
    let poseResult;
    try {
      handResult = this.hands.detectForVideo(video, timestampMs);
      poseResult = this.pose.detectForVideo(video, timestampMs);
    } catch {
      return null;
    }

    const poseLm = poseResult.landmarks?.[0] ?? null;
    const issues: FramingIssue[] = [];

    if (!poseLm) {
      return { t, left: null, right: null, pose: null, issues: ['no-person'] };
    }

    // Landmarks 11 and 12 are the shoulders in MediaPipe's pose topology.
    const ls = poseLm[11];
    const rs = poseLm[12];
    if (!ls || !rs) {
      return { t, left: null, right: null, pose: null, issues: ['no-person'] };
    }

    const originX = (ls.x + rs.x) / 2;
    const originY = (ls.y + rs.y) / 2;
    const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    // Coordinates are image-relative (0..1), so shoulder width is a direct
    // proxy for how much of the frame the signer occupies.
    if (shoulderWidth < 0.12) issues.push('too-far');
    if (shoulderWidth > 0.55) issues.push('too-close');

    const scale = shoulderWidth > 1e-4 ? shoulderWidth : 1;
    const norm = (lm: Landmark[]): Float32Array => {
      const out = new Float32Array(lm.length * 3);
      for (let i = 0; i < lm.length; i++) {
        const p = lm[i]!;
        out[i * 3] = (p.x - originX) / scale;
        out[i * 3 + 1] = (p.y - originY) / scale;
        out[i * 3 + 2] = p.z / scale;
      }
      return out;
    };

    let left: Float32Array | null = null;
    let right: Float32Array | null = null;
    const hands = handResult.landmarks ?? [];
    for (let i = 0; i < hands.length; i++) {
      const lm = hands[i];
      if (!lm) continue;
      // MediaPipe labels handedness as seen in the (mirrored) image. A webcam
      // preview is mirrored, so the label matches what the user perceives.
      const label = handResult.handedness?.[i]?.[0]?.categoryName;
      const normalised = norm(lm);
      if (label === 'Left') left = normalised;
      else right = normalised;
    }

    if (!left && !right) issues.push('hands-out-of-frame');

    const nose = poseLm[0];
    if (nose) {
      for (const hand of [left, right]) {
        if (!hand) continue;
        const wristX = hand[0]!;
        const wristY = hand[1]!;
        const noseX = (nose.x - originX) / scale;
        const noseY = (nose.y - originY) / scale;
        if (Math.hypot(wristX - noseX, wristY - noseY) < 0.35) {
          issues.push('hand-over-face');
          break;
        }
      }
    }

    return { t, left, right, pose: norm(poseLm), issues };
  }

  /**
   * Flatten a window of frames into the [T, F] tensor a recogniser consumes.
   * Missing hands become zeros, which the model must be trained to read as
   * absence rather than as a hand at the origin.
   */
  static toTensor(frames: FrameKeypoints[]): Float32Array {
    const out = new Float32Array(frames.length * FEATURES_PER_FRAME);
    frames.forEach((f, i) => {
      const base = i * FEATURES_PER_FRAME;
      if (f.left) out.set(f.left, base);
      if (f.right) out.set(f.right, base + HAND_POINTS * 3);
      if (f.pose) out.set(f.pose, base + HAND_POINTS * 3 * 2);
    });
    return out;
  }

  dispose(): void {
    this.hands?.close();
    this.pose?.close();
    this.hands = null;
    this.pose = null;
    this.status = { ready: false, usingGpu: false };
  }
}

export function describeIssue(issue: FramingIssue): string {
  switch (issue) {
    case 'no-person':
      return 'I can’t see you — check the camera is on and you’re in frame.';
    case 'too-far':
      return 'Move a little closer to the camera.';
    case 'too-close':
      return 'Move back a bit so your hands stay in frame.';
    case 'hands-out-of-frame':
      return 'Your hands are outside the frame.';
    case 'hand-over-face':
      return 'Your hand is covering your face — recognition will be less reliable.';
  }
}
