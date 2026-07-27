import {
  HEALTHY,
  type AdapterHealth,
  type DeliveryResult,
  type Participant,
  type PlatformAdapter,
  type PlatformCapabilities,
  type Unsubscribe,
} from '@slb/core';
import { attrContains, pressEnter, resolve, setNativeValue, visible } from './dom';
import { speak } from '../delivery/tts';
import { sendZoomCaption } from '../delivery/zoom-cc';
import { loadSettings } from '../settings';

/**
 * Zoom (web client) adapter.
 *
 * Zoom is the good case: it has a sanctioned third-party closed-caption API.
 * The host enables "Closed Caption → Third-party CC service" once, copies the
 * API token URL, and pastes it into our options. From then on our text renders
 * as native closed captions for every participant on every client, including
 * desktop and mobile, with correct positioning and the user's own caption size
 * preferences respected.
 *
 * That is a far better outcome than anything we can achieve by injecting into
 * a page, so the CC route is tried first and the others are fallbacks.
 */
export class ZoomWebAdapter implements PlatformAdapter {
  readonly id = 'zoom-web' as const;

  private speakerListeners = new Set<(p: Participant | null) => void>();
  private observer: MutationObserver | null = null;
  private lastSpeakerId: string | null = null;
  private ccConfigured = false;

  async attach(): Promise<void> {
    this.ccConfigured = (await loadSettings()).delivery.zoomCcUrl.trim() !== '';
    this.startSpeakerWatch();
  }

  async detach(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
    this.speakerListeners.clear();
  }

  capabilities(): PlatformCapabilities {
    return {
      nativeCC: this.ccConfigured,
      sidePanel: false,
      chat: resolve(chatInputStrategies()).value !== null,
      tts: true,
      activeSpeaker: this.currentSpeaker().via !== null,
    };
  }

  health(): AdapterHealth {
    const degraded: AdapterHealth['degraded'] = [];
    if (!this.ccConfigured) {
      degraded.push({
        capability: 'nativeCC',
        reason:
          'No Zoom caption URL set. Ask the host to enable third-party closed captions and paste the API token URL in settings — it gives everyone native captions.',
      });
    }
    return degraded.length === 0 ? HEALTHY : { ok: false, degraded };
  }

  onActiveSpeaker(fn: (p: Participant | null) => void): Unsubscribe {
    this.speakerListeners.add(fn);
    return () => this.speakerListeners.delete(fn);
  }

  async deliverOutbound(text: string, confidence: number): Promise<DeliveryResult> {
    if (this.ccConfigured) {
      const cc = await sendZoomCaption(text);
      if (cc.ok) return { ok: true, via: 'zoom-cc' };
      // Fall through — a failed CC POST should not swallow the utterance.
    }

    const spoken = await speak(text);
    if (spoken.ok) return { ok: true, via: 'tts' };

    const { value: input } = resolve(chatInputStrategies());
    if (input) {
      setNativeValue(input, (confidence < 0.75 ? '(uncertain) ' : '') + text);
      pressEnter(input);
      return { ok: true, via: 'chat' };
    }

    return { ok: false, via: 'overlay-only', error: spoken.error ?? 'No delivery route available.' };
  }

  private startSpeakerWatch(): void {
    const tick = (): void => {
      const { value } = this.currentSpeaker();
      const id = value?.id ?? null;
      if (id === this.lastSpeakerId) return;
      this.lastSpeakerId = id;
      for (const l of this.speakerListeners) l(value);
    };
    this.observer = new MutationObserver(() => tick());
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label'],
    });
    tick();
  }

  private currentSpeaker(): { value: Participant | null; via: string | null } {
    return resolve([
      {
        name: 'active-speaker-label',
        find: () => {
          const el = document.querySelector(
            `${attrContains('class', 'speaker-active')}, ${attrContains('class', 'active-speaker')}`,
          );
          if (!el || !visible(el)) return null;
          const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? null;
          return name ? { id: name, name, isSelf: false } : null;
        },
      },
    ]);
  }
}

function chatInputStrategies() {
  return [
    {
      name: 'zoom-chat-textarea',
      find: () =>
        document.querySelector<HTMLTextAreaElement>(
          `textarea${attrContains('aria-label', 'type message')}`,
        ),
    },
    {
      name: 'contenteditable-chat',
      find: () => {
        const el = document.querySelector<HTMLTextAreaElement>(
          `textarea${attrContains('class', 'chat')}`,
        );
        return el && visible(el) ? el : null;
      },
    },
  ];
}
