import type { GlossToken } from '@slb/core';

/**
 * Messages between the content script and the service worker.
 *
 * The content script cannot capture tab audio, cannot hold a long-lived
 * WebSocket reliably, and cannot make cross-origin requests to Zoom's caption
 * endpoint from a Meet page. All three live in the service worker.
 */

export type ToBackground =
  | { type: 'asr/start'; tabId?: number }
  | { type: 'asr/stop' }
  | { type: 'asr/status' }
  | { type: 'zoomcc/send'; text: string }
  | { type: 'claude/assemble'; tokens: GlossToken[]; language: 'asl' | 'bsl' }
  /** Content scripts cannot call chrome.runtime.openOptionsPage themselves. */
  | { type: 'options/open' };

export type ToContent =
  | { type: 'asr/partial'; text: string; utteranceStartedAt: number }
  | { type: 'asr/final'; text: string; utteranceStartedAt: number; confidence: number | null }
  | { type: 'asr/state'; running: boolean; engine: string; error?: string }
  | { type: 'command'; command: 'toggle-captions' | 'toggle-signing' | 'focus-compose' };

export interface BackgroundResponse {
  ok: boolean;
  error?: string;
  /** For claude/assemble: the candidate English, still to be validated by the caller. */
  text?: string;
  running?: boolean;
}

export async function sendToBackground(msg: ToBackground): Promise<BackgroundResponse> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as BackgroundResponse | undefined;
    return res ?? { ok: false, error: 'No response from the extension background.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function sendToContent(tabId: number, msg: ToContent): void {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // The tab may have navigated away mid-flight; nothing to recover.
  });
}
