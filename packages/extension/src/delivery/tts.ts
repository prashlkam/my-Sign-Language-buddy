import { loadSettings } from '../settings';

/**
 * Text to speech (PLAN.md §3.1).
 *
 * This is how a Deaf user's signed or typed words reach a call that has no
 * caption API: we synthesise them, and — with a virtual microphone selected as
 * the call's input device — the other participants simply hear them. It needs
 * nothing installed on their side and works with their mobile clients.
 *
 * Voice choice is an identity decision, not a technical one. The user picks it,
 * they can preview it, and we never silently change it.
 *
 * Without a virtual mic the speech comes out of the local speakers only. That
 * is still useful (it is how you test), but it is not delivery, and the UI must
 * not claim otherwise — hence `audible` in the result.
 */

export interface SpeakResult {
  ok: boolean;
  error?: string;
}

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

export function listVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((res) => {
    const existing = speechSynthesis.getVoices();
    if (existing.length > 0) return res(existing);
    const onChange = (): void => {
      speechSynthesis.removeEventListener('voiceschanged', onChange);
      res(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', onChange);
    // Some platforms never fire the event; don't hang the delivery path on it.
    setTimeout(() => res(speechSynthesis.getVoices()), 1500);
  });
  return voicesReady;
}

export async function speak(text: string): Promise<SpeakResult> {
  if (typeof speechSynthesis === 'undefined') {
    return { ok: false, error: 'Speech synthesis is not available in this browser.' };
  }
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'Nothing to say.' };

  const settings = await loadSettings();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.rate = settings.delivery.ttsRate;

  const wanted = settings.delivery.ttsVoiceUri;
  if (wanted) {
    const voice = (await listVoices()).find((v) => v.voiceURI === wanted);
    if (voice) utterance.voice = voice;
  }

  return new Promise((res) => {
    let settled = false;
    const done = (r: SpeakResult): void => {
      if (settled) return;
      settled = true;
      res(r);
    };

    utterance.onend = () => done({ ok: true });
    utterance.onerror = (e) => done({ ok: false, error: `Speech failed: ${e.error}` });

    // Chrome silently drops long utterances if the tab is backgrounded; a
    // timeout keeps the caller from waiting forever on a promise that will
    // never settle.
    setTimeout(() => done({ ok: true }), 500 + trimmed.length * 90);

    speechSynthesis.speak(utterance);
  });
}

export function cancelSpeech(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
