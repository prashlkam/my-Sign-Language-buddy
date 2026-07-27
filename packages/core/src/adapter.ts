import type {
  Caption,
  DeliveryResult,
  Participant,
  PlatformCapabilities,
  PlatformId,
  Unsubscribe,
} from './types';

/**
 * The platform seam (PLAN.md §4.5).
 *
 * Zoom and Meet change their DOM and their APIs on their own schedule. Every
 * assumption about a specific platform lives behind this interface so that
 * breakage is contained to one file, and so the generic (virtual cam/mic)
 * adapter — which depends on nobody's permission — is a peer of the others
 * rather than an afterthought.
 */
export interface PlatformAdapter {
  readonly id: PlatformId;

  attach(): Promise<void>;
  detach(): Promise<void>;

  capabilities(): PlatformCapabilities;

  /** Who is speaking right now, per the platform's own signal where available. */
  onActiveSpeaker(fn: (p: Participant | null) => void): Unsubscribe;

  /** Sign → everyone else. Returns which route actually carried it. */
  deliverOutbound(text: string, confidence: number): Promise<DeliveryResult>;

  /** Speech → the local user. The overlay owns rendering; this is a hook for
   *  platform-native surfaces (side panels) where they exist. */
  renderInbound?(caption: Caption): void;

  /**
   * Whether the adapter still recognises the page it is attached to.
   * Meet's DOM will change; when it does we want to degrade to a floating
   * window and say so, not fail silently (PLAN.md §4.5).
   */
  health(): AdapterHealth;
}

export interface AdapterHealth {
  ok: boolean;
  /** Which capabilities are currently unavailable and why. */
  degraded: Array<{ capability: keyof PlatformCapabilities; reason: string }>;
}

export const HEALTHY: AdapterHealth = { ok: true, degraded: [] };
