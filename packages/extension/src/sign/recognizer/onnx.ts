import { UNCLEAR, type GlossToken } from '@slb/core';
import type { Segment } from '../segmenter';
import type { SignRecognizer } from './types';
import { FEATURES_PER_FRAME, KeypointExtractor } from '../keypoints';

/**
 * ONNX recogniser (PLAN.md §4.2, §6 M3).
 *
 * The model this loads does not exist yet — training it is M3, and it needs the
 * data strategy in §7 and the signer-independent evaluation in §8 first. What
 * exists here is the runtime contract it must satisfy, so that dropping in
 * weights is a configuration change rather than a rewrite:
 *
 *   input   float32 [1, T, F]  T = WINDOW_FRAMES, F = FEATURES_PER_FRAME
 *   output  float32 [1, C]     raw logits over the label set
 *   labels  models/<name>.labels.json  → { labels: string[], temperature: number }
 *
 * Two things here are not optional:
 *
 *  - **Temperature scaling.** Raw softmax over a classifier trained on isolated
 *    signs is wildly overconfident, especially on inputs unlike anything in
 *    training. The temperature is fitted on held-out *signers* (not held-out
 *    clips from the same signers, which inflates everything) and shipped
 *    alongside the weights.
 *  - **Abstention.** Below the threshold we emit UNCLEAR. The whole design
 *    depends on the model being willing to say it does not know.
 */

export const WINDOW_FRAMES = 64;

interface LabelFile {
  labels: string[];
  /** Fitted on held-out signers. >1 softens overconfident logits. */
  temperature?: number;
  /** Model card URL — required to travel with the weights (PLAN.md §14 Q5). */
  modelCard?: string;
}

type OrtModule = typeof import('onnxruntime-web');

export class OnnxSignRecognizer implements SignRecognizer {
  readonly id = 'onnx';
  readonly kind = 'onnx' as const;
  readonly description = 'Trained keypoint model (ONNX Runtime Web).';

  private ort: OrtModule | null = null;
  private session: import('onnxruntime-web').InferenceSession | null = null;
  private labels: string[] = [];
  private temperature = 1;

  constructor(
    private readonly modelUrl: string,
    private readonly abstainBelow: number,
  ) {}

  get vocabulary(): readonly string[] {
    return this.labels;
  }

  async init(): Promise<{ ok: boolean; error?: string }> {
    if (!this.modelUrl.trim()) {
      return { ok: false, error: 'No recogniser model is configured.' };
    }
    try {
      // Imported lazily: ONNX Runtime is tens of megabytes and most sessions
      // never turn the sign pipeline on.
      this.ort = await import('onnxruntime-web');
      this.ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
      this.ort.env.wasm.numThreads = 1; // No cross-origin isolation in a content script.

      this.session = await this.ort.InferenceSession.create(this.modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      const meta = await this.loadLabels();
      if (!meta.ok) return meta;
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `Could not load the recogniser: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async loadLabels(): Promise<{ ok: boolean; error?: string }> {
    const labelUrl = this.modelUrl.replace(/\.onnx$/, '') + '.labels.json';
    try {
      const res = await fetch(labelUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = (await res.json()) as LabelFile;
      if (!Array.isArray(parsed.labels) || parsed.labels.length === 0) {
        throw new Error('label file contains no labels');
      }
      this.labels = parsed.labels;
      this.temperature = parsed.temperature && parsed.temperature > 0 ? parsed.temperature : 1;
      if (this.temperature === 1) {
        console.warn(
          '[slb] recogniser has no fitted temperature; confidences will be overconfident ' +
            'and the abstention threshold will not mean what it should.',
        );
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `Model loaded but its labels did not (${labelUrl}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  async recognise(segment: Segment): Promise<GlossToken | null> {
    if (!this.session || !this.ort) return null;

    const frames = resample(segment.frames, WINDOW_FRAMES);
    if (frames.length === 0) return null;

    const data = KeypointExtractor.toTensor(frames);
    const input = new this.ort.Tensor('float32', data, [1, WINDOW_FRAMES, FEATURES_PER_FRAME]);

    const inputName = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];
    if (!inputName || !outputName) return null;

    let logits: Float32Array;
    try {
      const out = await this.session.run({ [inputName]: input });
      const tensor = out[outputName];
      if (!tensor) return null;
      logits = tensor.data as Float32Array;
    } catch (err) {
      console.warn('[slb] inference failed', err);
      return null;
    }

    const { index, probability } = argmaxSoftmax(logits, this.temperature);
    const label = this.labels[index];

    // Below threshold, or a label we cannot name: say so rather than guess.
    if (!label || probability < this.abstainBelow) {
      return {
        gloss: UNCLEAR,
        confidence: probability,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      };
    }

    return {
      gloss: label,
      confidence: probability,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    };
  }

  dispose(): void {
    void this.session?.release();
    this.session = null;
  }
}

/** Softmax with temperature; returns only the winner, which is all we need. */
function argmaxSoftmax(logits: Float32Array, temperature: number): {
  index: number;
  probability: number;
} {
  let maxLogit = -Infinity;
  let index = 0;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i]! / temperature;
    if (v > maxLogit) {
      maxLogit = v;
      index = i;
    }
  }
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    sum += Math.exp(logits[i]! / temperature - maxLogit);
  }
  return { index, probability: sum > 0 ? 1 / sum : 0 };
}

/**
 * Uniformly resample a variable-length segment to the fixed window the model
 * expects. Nearest-neighbour in time: signs vary in speed, and interpolating
 * between keypoint frames invents hand positions that never occurred.
 */
function resample<T>(frames: T[], target: number): T[] {
  if (frames.length === 0) return [];
  if (frames.length === target) return frames;
  const out: T[] = new Array(target);
  for (let i = 0; i < target; i++) {
    const src = Math.min(frames.length - 1, Math.round((i * (frames.length - 1)) / (target - 1)));
    out[i] = frames[src]!;
  }
  return out;
}
