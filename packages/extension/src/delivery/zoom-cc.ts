import { sendToBackground } from '../messages';

/**
 * Zoom third-party closed captions.
 *
 * The host enables Closed Caption → "I will type" / third-party service and
 * copies an API token URL. Posting sequenced plain-text lines to that URL makes
 * them appear as native Zoom captions for every participant, on every client.
 *
 * Sequence numbers must be monotonic per meeting — Zoom drops out-of-order or
 * repeated sequence numbers — so the counter lives in the service worker, which
 * outlives any individual page.
 */
export async function sendZoomCaption(text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await sendToBackground({ type: 'zoomcc/send', text });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
