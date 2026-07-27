/**
 * Shared vocabulary of types. Kept deliberately small — every type here crosses
 * a process boundary (content script ↔ service worker ↔ desktop helper), so
 * changes are breaking changes.
 */

/**
 * PLAN.md §4.2: ASL and BSL are different languages with different manual
 * alphabets and grammar. This is a union, never a boolean, and never a string,
 * so that adding a language forces every switch to be revisited.
 */
export type SignLanguage = 'asl' | 'bsl';

export type PlatformId = 'zoom-desktop' | 'zoom-web' | 'meet' | 'generic';

export interface Participant {
  id: string;
  /** Display name as shown by the platform. May be absent while a call is joining. */
  name: string | null;
  isSelf: boolean;
}

/** Where a caption line came from. Rendered differently, and never conflated. */
export type CaptionSource =
  /** Remote audio, transcribed by us. */
  | 'asr'
  /** The local user's signing, recognised by us. */
  | 'sign'
  /** The local user typed it. */
  | 'typed'
  /** Informational line from the app itself (errors, coaching). */
  | 'system';

export interface Caption {
  id: string;
  source: CaptionSource;
  speaker: Participant | null;
  text: string;
  /** True while the text may still change. Committed lines never mutate. */
  interim: boolean;
  /** 0..1, calibrated where the producer can calibrate it; null where it cannot. */
  confidence: number | null;
  /** performance.timeOrigin-relative ms at which the underlying signal started. */
  startedAt: number;
  /** ms at which this version of the text was produced. */
  producedAt: number;
}

/**
 * One recognised sign, before assembly into English.
 * `gloss` is an uppercase ASL/BSL gloss label, or the UNCLEAR sentinel.
 */
export interface GlossToken {
  gloss: string;
  confidence: number;
  startedAt: number;
  endedAt: number;
}

/**
 * PLAN.md §4.2 — the model must be able to say "I don't know". This sentinel
 * survives all the way to the rendered caption as a visible gap; it is never
 * silently dropped and never filled in by the language model.
 */
export const UNCLEAR = '⟨unclear⟩';

export interface AssembledUtterance {
  text: string;
  /** Lowest confidence across contributing tokens — the chain is as weak as its weakest link. */
  confidence: number;
  /** True if any UNCLEAR token contributed. Drives the UI warning. */
  hasGaps: boolean;
  tokens: GlossToken[];
}

export interface DeliveryResult {
  ok: boolean;
  /** Which route actually carried the text, for the UI to report honestly. */
  via: 'zoom-cc' | 'tts' | 'chat' | 'overlay-only' | 'none';
  error?: string;
}

export interface PlatformCapabilities {
  /** Can we put text into the platform's own closed-caption channel? */
  nativeCC: boolean;
  sidePanel: boolean;
  chat: boolean;
  /** Can we speak into the call? (Requires a virtual mic on the OS side.) */
  tts: boolean;
  /** Can we identify who is currently speaking? */
  activeSpeaker: boolean;
}

export type Unsubscribe = () => void;
