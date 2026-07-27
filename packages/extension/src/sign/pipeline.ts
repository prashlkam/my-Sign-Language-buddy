import {
  assembleRuleBased,
  chooseAssembly,
  latency,
  type AssembledUtterance,
  type GlossToken,
  type SignLanguage,
} from '@slb/core';
import { KeypointExtractor, describeIssue, type FramingIssue } from './keypoints';
import { SigningSegmenter } from './segmenter';
import { DemoGestureRecognizer } from './recognizer/demo';
import { OnnxSignRecognizer } from './recognizer/onnx';
import type { SignRecognizer } from './recognizer/types';
import { sendToBackground } from '../messages';
import type { Settings } from '../settings';

/**
 * The sign→text pipeline (PLAN.md §4.1–§4.3).
 *
 * camera → keypoints → segmentation → recognition → gloss assembly → a
 * *pending* utterance that the user reviews before anything is sent.
 *
 * That last step is the important one. With today's accuracy, auto-sending
 * recognised signs would mean broadcasting a machine's guess about what a Deaf
 * person said, in their name, to their colleagues. Review-before-send is not a
 * degraded mode — it is the design.
 */

export interface PendingUtterance {
  id: string;
  utterance: AssembledUtterance;
  /** Which assembler produced the text, so the UI can be honest about it. */
  via: 'llm' | 'rule-based';
  /** True when a low-confidence or unlicensed candidate was rejected. */
  guardTripped: boolean;
  createdAt: number;
}

export interface SignStatus {
  running: boolean;
  extractorReady: boolean;
  recognizerId: string;
  /** 'demo' obliges the UI to show the not-sign-recognition warning. */
  recognizerKind: 'demo' | 'onnx';
  segmenterState: 'idle' | 'signing';
  energy: number;
  error?: string;
}

export interface SignPipelineCallbacks {
  onStatus: (s: SignStatus) => void;
  onCoach: (messages: string[]) => void;
  onToken: (t: GlossToken) => void;
  onUtterance: (u: PendingUtterance) => void;
}

/** Silence after the last sign before we consider the utterance complete. */
const UTTERANCE_GAP_MS = 1400;

export class SignPipeline {
  private extractor = new KeypointExtractor();
  private segmenter: SigningSegmenter;
  private recognizer: SignRecognizer;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private running = false;
  private frameIndex = 0;

  private tokens: GlossToken[] = [];
  private utteranceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCoach = '';
  private seq = 0;
  private status: SignStatus;

  constructor(
    private settings: Settings,
    private readonly cb: SignPipelineCallbacks,
  ) {
    this.segmenter = new SigningSegmenter();
    this.recognizer = settings.sign.modelUrl.trim()
      ? new OnnxSignRecognizer(settings.sign.modelUrl, settings.sign.abstainBelow)
      : new DemoGestureRecognizer();
    this.status = {
      running: false,
      extractorReady: false,
      recognizerId: this.recognizer.id,
      recognizerKind: this.recognizer.kind,
      segmenterState: 'idle',
      energy: 0,
    };
  }

  getStatus(): SignStatus {
    return this.status;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const init = await this.extractor.init();
    if (!init.ready) {
      this.setStatus({ extractorReady: false, error: init.error });
      return;
    }

    const rec = await this.recognizer.init();
    if (!rec.ok) {
      // A missing trained model is expected right now — fall back to the demo
      // heuristics rather than leaving the user with a dead camera, and make
      // very sure the UI knows it is showing demo output.
      this.recognizer = new DemoGestureRecognizer();
      await this.recognizer.init();
      this.setStatus({
        recognizerId: this.recognizer.id,
        recognizerKind: this.recognizer.kind,
        error: rec.error,
      });
    }

    try {
      // 640×480/30 is plenty for keypoints, and asking for more competes with
      // the call's own encoder for the same hardware (PLAN.md §4.1).
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (err) {
      this.setStatus({
        running: false,
        error:
          err instanceof Error && err.name === 'NotReadableError'
            ? 'The camera is already in use and could not be opened a second time. Some webcams only allow one application at a time.'
            : `Camera unavailable: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    // Kept out of the layout; the frames are consumed, never displayed here.
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    await video.play().catch(() => undefined);
    this.video = video;

    this.running = true;
    this.setStatus({ running: true, extractorReady: true, error: undefined });
    this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;

    this.segmenter.reset();
    this.flushUtterance();
    this.setStatus({ running: false, segmenterState: 'idle', energy: 0 });
  }

  dispose(): void {
    void this.stop();
    this.extractor.dispose();
    this.recognizer.dispose();
  }

  /** Called when the hold-to-sign hotkey is released. */
  endTurn(): void {
    const seg = this.segmenter.flush();
    if (seg) void this.handleSegment(seg);
    this.flushUtterance();
  }

  private loop = (): void => {
    if (!this.running || !this.video) return;
    this.rafId = requestAnimationFrame(this.loop);

    const video = this.video;
    if (video.readyState < 2) return;

    // MediaPipe needs a monotonic timestamp; the frame counter is safer than
    // video.currentTime, which can stall or rewind on track changes.
    const frame = this.extractor.extract(video, this.frameIndex++ * 33);
    if (!frame) return;

    this.coach(frame.issues);

    const segment = this.segmenter.push(frame);
    this.setStatus({
      segmenterState: this.segmenter.getState(),
      energy: this.segmenter.getEnergy(),
    });

    if (segment) void this.handleSegment(segment);
  };

  private async handleSegment(segment: Parameters<SignRecognizer['recognise']>[0]): Promise<void> {
    const token = await this.recognizer.recognise(segment);
    if (!token) return;

    latency.mark('recognised', segment.startedAt);
    this.tokens.push(token);
    this.cb.onToken(token);

    if (this.utteranceTimer) clearTimeout(this.utteranceTimer);
    this.utteranceTimer = setTimeout(() => this.flushUtterance(), UTTERANCE_GAP_MS);
  }

  /** Assemble everything collected so far into one reviewable utterance. */
  private flushUtterance(): void {
    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer);
      this.utteranceTimer = null;
    }
    const tokens = this.tokens;
    this.tokens = [];
    if (tokens.length === 0) return;
    void this.assemble(tokens);
  }

  private async assemble(tokens: GlossToken[]): Promise<void> {
    const opts = {
      language: this.settings.signLanguage as SignLanguage,
      abstainBelow: this.settings.sign.abstainBelow,
    };

    let candidate: string | null = null;
    if (this.settings.cloud.glossBackend === 'claude') {
      // Only glosses leave the device on this path — never video, audio, or
      // keypoints (PLAN.md §4.3, §10).
      const res = await sendToBackground({
        type: 'claude/assemble',
        tokens,
        language: opts.language,
      });
      candidate = res.ok ? (res.text ?? null) : null;
    }

    const chosen = chooseAssembly(tokens, candidate, opts);
    if (chosen.rejection) {
      console.warn(
        '[slb] rejected an assembled candidate that was not supported by the recognised signs:',
        chosen.rejection,
      );
    }

    const utterance = chosen.utterance.text === '' ? assembleRuleBased(tokens, opts) : chosen.utterance;
    if (utterance.text.trim() === '') return;

    latency.mark('assembled', tokens[0]!.startedAt);

    this.cb.onUtterance({
      id: `u${++this.seq}`,
      utterance,
      via: chosen.via,
      guardTripped: chosen.rejection !== undefined,
      createdAt: performance.now(),
    });
  }

  /** Tell the user about framing problems instead of silently degrading (§4.1). */
  private coach(issues: FramingIssue[]): void {
    if (!this.settings.sign.showFramingCoach) return;
    const messages = issues.map(describeIssue);
    const key = messages.join('|');
    if (key === this.lastCoach) return;
    this.lastCoach = key;
    this.cb.onCoach(messages);
  }

  private setStatus(patch: Partial<SignStatus>): void {
    this.status = { ...this.status, ...patch };
    this.cb.onStatus(this.status);
  }
}
