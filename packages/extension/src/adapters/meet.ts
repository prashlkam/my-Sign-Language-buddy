import {
  HEALTHY,
  type AdapterHealth,
  type DeliveryResult,
  type Participant,
  type PlatformAdapter,
  type PlatformCapabilities,
  type Unsubscribe,
} from '@slb/core';
import { attrContains, pressEnter, resolve, setNativeValue, visible, waitFor } from './dom';
import { speak } from '../delivery/tts';

/**
 * Google Meet adapter (PLAN.md §4.5).
 *
 * Meet has no third-party caption-injection API, so outbound text cannot become
 * a native caption for other participants. The ranked routes are:
 *
 *   1. TTS into a virtual microphone — everyone hears it, and Meet's own
 *      captions transcribe it for anyone reading. Needs no install from the
 *      other participants and works on their mobile clients. This is the
 *      default and it is the reason the desktop helper exists.
 *   2. Auto-post to the meeting chat — no helper needed, but noisy and easy
 *      for people to miss.
 *   3. Overlay only — the DHH user sees their own recognised text; nobody else
 *      does. Not a delivery route, but an honest terminal state.
 *
 * ⚠ The selectors below are written from Meet's published accessibility
 * affordances (roles and aria-labels) rather than its obfuscated class names,
 * which makes them more durable but NOT durable. They are unverified against a
 * live call in this build. `health()` reports what is currently resolvable so
 * the UI can tell the user which routes actually work right now.
 */
export class MeetAdapter implements PlatformAdapter {
  readonly id = 'meet' as const;

  private speakerListeners = new Set<(p: Participant | null) => void>();
  private observer: MutationObserver | null = null;
  private lastSpeakerId: string | null = null;
  private chatResolvable = false;

  async attach(): Promise<void> {
    const chat = await waitFor(chatInputStrategies(), 5_000);
    this.chatResolvable = chat.value !== null;
    this.startSpeakerWatch();
  }

  async detach(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
    this.speakerListeners.clear();
  }

  capabilities(): PlatformCapabilities {
    return {
      nativeCC: false,
      sidePanel: false,
      chat: this.chatResolvable,
      tts: true,
      activeSpeaker: this.currentSpeaker().via !== null,
    };
  }

  health(): AdapterHealth {
    const degraded: AdapterHealth['degraded'] = [];
    if (!this.chatResolvable) {
      degraded.push({
        capability: 'chat',
        reason: 'Could not find the Meet chat box. Open the chat panel once, or use voice output.',
      });
    }
    if (this.currentSpeaker().via === null) {
      degraded.push({
        capability: 'activeSpeaker',
        reason: 'Cannot tell who is speaking; captions will be shown without names.',
      });
    }
    return degraded.length === 0 ? HEALTHY : { ok: false, degraded };
  }

  onActiveSpeaker(fn: (p: Participant | null) => void): Unsubscribe {
    this.speakerListeners.add(fn);
    return () => this.speakerListeners.delete(fn);
  }

  async deliverOutbound(text: string, confidence: number): Promise<DeliveryResult> {
    // Voice first: it reaches everyone, including people on phones.
    const spoken = await speak(text);
    if (spoken.ok) return { ok: true, via: 'tts' };

    if (this.chatResolvable) {
      const posted = this.postToChat(text, confidence);
      if (posted) return { ok: true, via: 'chat' };
    }

    return {
      ok: false,
      via: 'overlay-only',
      error: spoken.error ?? 'No delivery route available on this page.',
    };
  }

  private postToChat(text: string, confidence: number): boolean {
    const { value: input } = resolve(chatInputStrategies());
    if (!input) return false;
    // Low-confidence text is marked in the chat itself. Other participants
    // deserve to know the machine was unsure, not just the person signing.
    const prefix = confidence < 0.75 ? '(uncertain) ' : '';
    setNativeValue(input, prefix + text);
    pressEnter(input);
    return true;
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
      attributes: true,
      childList: true,
      attributeFilter: ['class', 'aria-label', 'data-participant-id', 'data-self-name'],
    });
    tick();
  }

  /**
   * Meet marks the active speaker visually rather than semantically, so this is
   * a heuristic over the participant tiles. When it fails we return null and
   * captions go out unattributed — which is a worse experience, but a much
   * better one than confidently labelling the wrong person.
   */
  private currentSpeaker(): { value: Participant | null; via: string | null } {
    return resolve([
      {
        name: 'aria-speaking-tile',
        find: () => {
          const tile = document.querySelector(
            `[data-participant-id]${attrContains('aria-label', 'is speaking')}`,
          );
          return tile ? participantFromTile(tile) : null;
        },
      },
      {
        name: 'tile-with-speaking-indicator',
        find: () => {
          for (const tile of document.querySelectorAll('[data-participant-id]')) {
            // Meet animates a small indicator inside the speaking tile. We
            // cannot rely on its class name, so we look for a visible element
            // whose aria-label mentions speech.
            const ind = tile.querySelector(
              `${attrContains('aria-label', 'speaking')}, ${attrContains('aria-label', 'unmuted')}`,
            );
            if (ind && visible(ind)) return participantFromTile(tile);
          }
          return null;
        },
      },
    ]);
  }
}

function participantFromTile(tile: Element): Participant | null {
  const id = tile.getAttribute('data-participant-id');
  if (!id) return null;
  const name =
    tile.querySelector('[data-self-name]')?.getAttribute('data-self-name') ??
    tile.getAttribute('data-participant-name') ??
    tile.textContent?.trim().split('\n')[0] ??
    null;
  return { id, name: name && name.length < 60 ? name : null, isSelf: false };
}

function chatInputStrategies() {
  return [
    {
      name: 'aria-send-a-message',
      find: () =>
        document.querySelector<HTMLTextAreaElement>(
          `textarea${attrContains('aria-label', 'send a message')}`,
        ),
    },
    {
      name: 'aria-message',
      find: () =>
        document.querySelector<HTMLTextAreaElement>(
          `textarea${attrContains('aria-label', 'message')}`,
        ),
    },
    {
      name: 'any-visible-textarea',
      find: () => {
        const areas = [...document.querySelectorAll<HTMLTextAreaElement>('textarea')];
        return areas.find((a) => visible(a) && !a.readOnly) ?? null;
      },
    },
  ];
}
