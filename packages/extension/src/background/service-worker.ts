import { buildClaudeRequest, type GlossToken } from '@slb/core';
import { loadSettings } from '../settings';
import type { BackgroundResponse, ToBackground, ToContent } from '../messages';

/**
 * Service worker: the parts of the extension that need privileges or that must
 * outlive a page.
 *
 *   - tab audio capture (the content script cannot do it)
 *   - the offscreen document's lifecycle
 *   - Zoom's caption endpoint (cross-origin from a Meet page)
 *   - the opt-in Claude call (keeps the key out of the page context)
 *   - global hotkeys
 *
 * MV3 service workers are killed aggressively, so nothing important is kept in
 * module state except the Zoom caption sequence number, which is rebuilt from
 * storage if we are restarted mid-meeting.
 */

const OFFSCREEN_PATH = 'offscreen.html';
let captureTabId: number | null = null;

// ---------------------------------------------------------------- offscreen

async function hasOffscreen(): Promise<boolean> {
  // getContexts is newer than the shipped @types/chrome, hence the cast.
  const getContexts = (
    chrome.runtime as unknown as {
      getContexts?: (f: { contextTypes: string[] }) => Promise<unknown[]>;
    }
  ).getContexts;
  if (!getContexts) return false;
  const contexts = await getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification:
      "Captures the call's audio and converts it to PCM for local transcription.",
  });
}

// --------------------------------------------------------------------- ASR

async function startAsr(): Promise<BackgroundResponse> {
  const settings = await loadSettings();
  if (settings.asr.engine !== 'helper') {
    return { ok: false, error: 'The helper engine is not selected in settings.' };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'No active tab to capture.' };

  const targetTabId = tab.id;
  let streamId: string;
  try {
    streamId = await new Promise<string>((res, rej) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) => {
        const err = chrome.runtime.lastError;
        if (err || !id) rej(new Error(err?.message ?? 'no stream id returned'));
        else res(id);
      });
    });
  } catch {
    return {
      ok: false,
      // getMediaStreamId needs a user gesture on the tab; say so plainly rather
      // than leaving the user staring at an empty caption box.
      error:
        'Chrome would not grant audio capture for this tab. Click the extension icon from the call tab and try again.',
    };
  }

  captureTabId = tab.id;
  await ensureOffscreen();
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    streamId,
    port: settings.asr.helperPort,
    token: settings.asr.helperToken,
    language: settings.asr.language,
  });
  return { ok: true, running: true };
}

async function stopAsr(): Promise<BackgroundResponse> {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => undefined);
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
  captureTabId = null;
  return { ok: true, running: false };
}

/** Relay transcripts from the offscreen document to the page showing captions. */
function relayToContent(msg: ToContent): void {
  if (captureTabId === null) return;
  chrome.tabs.sendMessage(captureTabId, msg).catch(() => undefined);
}

// -------------------------------------------------------------- Zoom CC API

const SEQ_KEY = 'zoomCcSeq';

/**
 * Zoom rejects captions whose sequence number is not strictly increasing, and
 * it keeps counting for the life of the meeting — so the counter must survive
 * a service-worker restart.
 */
async function nextSeq(): Promise<number> {
  const got = await chrome.storage.session.get(SEQ_KEY);
  const seq = typeof got[SEQ_KEY] === 'number' ? got[SEQ_KEY] + 1 : 1;
  await chrome.storage.session.set({ [SEQ_KEY]: seq });
  return seq;
}

async function sendZoomCaption(text: string): Promise<BackgroundResponse> {
  const settings = await loadSettings();
  const base = settings.delivery.zoomCcUrl.trim();
  if (!base) return { ok: false, error: 'No Zoom caption URL is configured.' };

  const seq = await nextSeq();
  const url = `${base}${base.includes('?') ? '&' : '?'}seq=${seq}&lang=en-US`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    });
    if (!res.ok) {
      return { ok: false, error: `Zoom rejected the caption (HTTP ${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------- Claude (opt-in)

/**
 * Opt-in gloss→English. Only the gloss sequence is sent — no video, no audio,
 * no keypoints, no identifiers (PLAN.md §4.3, §10). The caller still runs the
 * fabrication guard on whatever comes back; this function is a transport, and
 * it is not trusted to have obeyed its own prompt.
 */
async function assembleWithClaude(
  tokens: GlossToken[],
  language: 'asl' | 'bsl',
): Promise<BackgroundResponse> {
  const settings = await loadSettings();
  const key = settings.cloud.anthropicApiKey.trim();
  if (!key) return { ok: false, error: 'No API key is set for the cloud assembler.' };

  const granted = await chrome.permissions.contains({
    origins: ['https://api.anthropic.com/*'],
  });
  if (!granted) {
    return {
      ok: false,
      error: 'Network access to the Claude API has not been granted. Enable it in settings.',
    };
  }

  const body = buildClaudeRequest(tokens, { language, model: settings.cloud.claudeModel });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Claude API error (HTTP ${res.status}).` };

    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((c) => c.type === 'text')?.text ?? null;
    return text ? { ok: true, text } : { ok: false, error: 'Empty response from the API.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------ routing

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as (ToBackground & { target?: string }) | (ToContent & { target?: string });

  // Messages coming back from the offscreen document.
  if ((raw as { target?: string })?.target === 'background') {
    relayToContent(raw as ToContent);
    return false;
  }

  const handle = async (): Promise<BackgroundResponse> => {
    switch ((msg as ToBackground).type) {
      case 'asr/start':
        return startAsr();
      case 'asr/stop':
        return stopAsr();
      case 'asr/status':
        return { ok: true, running: await hasOffscreen() };
      case 'zoomcc/send':
        return sendZoomCaption((msg as { text: string }).text);
      case 'claude/assemble': {
        const m = msg as { tokens: GlossToken[]; language: 'asl' | 'bsl' };
        return assembleWithClaude(m.tokens, m.language);
      }
      case 'options/open':
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown message.' };
    }
  };

  handle().then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true; // async response
});

chrome.commands.onCommand.addListener((command) => {
  if (
    command !== 'toggle-captions' &&
    command !== 'toggle-signing' &&
    command !== 'focus-compose'
  ) {
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'command', command }).catch(() => undefined);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === captureTabId) void stopAsr();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // First run opens the options page, which carries the one-time notice about
  // what this tool is and is not appropriate for (PLAN.md §11).
  if (reason === 'install') void chrome.runtime.openOptionsPage();
});
