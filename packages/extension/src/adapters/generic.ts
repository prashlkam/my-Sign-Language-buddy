import {
  HEALTHY,
  type AdapterHealth,
  type DeliveryResult,
  type Participant,
  type PlatformAdapter,
  type PlatformCapabilities,
  type Unsubscribe,
} from '@slb/core';
import { speak } from '../delivery/tts';

/**
 * The platform-agnostic adapter (PLAN.md §4.5).
 *
 * No DOM assumptions, no vendor API, nothing that anyone can revoke or break in
 * a release. Captions render in our own overlay; outbound text is spoken, and
 * with a virtual microphone on the OS side that voice reaches the call — any
 * call, on any service.
 *
 * This is deliberately a peer of the Zoom and Meet adapters rather than a
 * degraded mode. It is the route that keeps working when a platform changes its
 * markup or its terms, and it is what power users will run.
 */
export class GenericAdapter implements PlatformAdapter {
  readonly id = 'generic' as const;

  async attach(): Promise<void> {}
  async detach(): Promise<void> {}

  capabilities(): PlatformCapabilities {
    return {
      nativeCC: false,
      sidePanel: false,
      chat: false,
      tts: true,
      activeSpeaker: false,
    };
  }

  health(): AdapterHealth {
    return HEALTHY;
  }

  onActiveSpeaker(_fn: (p: Participant | null) => void): Unsubscribe {
    // Nothing to attribute against; captions are shown unattributed.
    return () => {};
  }

  async deliverOutbound(text: string): Promise<DeliveryResult> {
    const spoken = await speak(text);
    return spoken.ok
      ? { ok: true, via: 'tts' }
      : { ok: false, via: 'overlay-only', error: spoken.error };
  }
}
