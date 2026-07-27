import type { SignLanguage } from '@slb/core';

/**
 * Settings schema and storage.
 *
 * Two rules encoded here rather than left to the UI:
 *  - Everything privacy-relevant defaults to the private option (PLAN.md §10).
 *  - `confirmBeforeSend` defaults to on (PLAN.md §3.1 / §14 Q4). Sign
 *    recognition is not accurate enough to speak for someone unreviewed, and
 *    the user staying in control of their own words is the point.
 */

export type AsrEngine = 'off' | 'web-speech' | 'helper';
export type DeliveryRoute = 'auto' | 'tts' | 'chat' | 'zoom-cc' | 'overlay-only';
export type GlossBackend = 'rule-based' | 'claude';

export interface Settings {
  enabled: boolean;
  signLanguage: SignLanguage;

  asr: {
    engine: AsrEngine;
    /** BCP-47. null lets the engine decide. */
    language: string | null;
    helperPort: number;
    helperToken: string;
    /** Local agreement-n for the stable-prefix committer. */
    agreement: number;
  };

  captions: {
    fontSizePx: number;
    fontFamily: 'system' | 'serif' | 'mono' | 'opendyslexic';
    maxVisibleLines: number;
    position: 'bottom' | 'top' | 'floating';
    opacity: number;
    showConfidence: boolean;
    /** Colour is an accent only; names are always shown (colour alone fails WCAG). */
    colourBySpeaker: boolean;
  };

  sign: {
    enabled: boolean;
    /** Require an explicit hotkey to start signing (PLAN.md §4.2). */
    requireHotkey: boolean;
    confirmBeforeSend: boolean;
    /** Below this calibrated confidence a sign becomes a visible gap, not a guess. */
    abstainBelow: number;
    /** URL of an ONNX recogniser. Empty = no trained model available. */
    modelUrl: string;
    showFramingCoach: boolean;
  };

  delivery: {
    route: DeliveryRoute;
    ttsVoiceUri: string | null;
    ttsRate: number;
    /** Zoom's third-party closed-caption POST URL, provided by the host. */
    zoomCcUrl: string;
  };

  cloud: {
    glossBackend: GlossBackend;
    claudeModel: string;
    /** Stored locally. See the warning in the options page. */
    anthropicApiKey: string;
  };

  privacy: {
    /** Off means caption history is in-memory only and dies with the tab. */
    persistHistory: boolean;
    /** Opt-in, aggregate only. Nothing is sent while this is false. */
    telemetry: boolean;
  };

  /** Set once the one-time limitations notice has been acknowledged. */
  onboardingAcknowledgedAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  signLanguage: 'asl',

  asr: {
    engine: 'web-speech',
    language: null,
    helperPort: 8757,
    helperToken: '',
    agreement: 2,
  },

  captions: {
    fontSizePx: 26,
    fontFamily: 'system',
    maxVisibleLines: 3,
    position: 'bottom',
    opacity: 0.92,
    showConfidence: true,
    colourBySpeaker: true,
  },

  sign: {
    enabled: false,
    requireHotkey: true,
    confirmBeforeSend: true,
    abstainBelow: 0.7,
    modelUrl: '',
    showFramingCoach: true,
  },

  delivery: {
    route: 'auto',
    ttsVoiceUri: null,
    ttsRate: 1,
    zoomCcUrl: '',
  },

  cloud: {
    glossBackend: 'rule-based',
    claudeModel: 'claude-sonnet-5',
    anthropicApiKey: '',
  },

  privacy: {
    persistHistory: false,
    telemetry: false,
  },

  onboardingAcknowledgedAt: null,
};

const KEY = 'settings';

/**
 * Settings must never be able to take the UI down with them.
 *
 * `chrome.storage` is absent whenever a page is opened outside an extension
 * context — previewing the options page from the filesystem, a test harness, a
 * storage failure inside a real install. Previously that threw inside a
 * useEffect, React unmounted the tree, and the user got a blank white page with
 * nothing to act on. A caption tool losing its entire settings UI because a
 * storage read failed is a bad trade.
 *
 * So storage is treated as optional. When it is missing we fall back to an
 * in-memory store: the UI works, changes apply for the session, and the caller
 * is told they will not persist.
 */
let memoryStore: Settings | null = null;
const memoryListeners = new Set<(s: Settings) => void>();
let warned = false;

function storageArea(): chrome.storage.StorageArea | null {
  try {
    return globalThis.chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

/** True when settings are persisting. False means this session only. */
export function settingsArePersistent(): boolean {
  return storageArea() !== null;
}

function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    '[slb] chrome.storage is unavailable — settings will apply for this session only. ' +
      'This is expected when previewing a page outside the extension.',
  );
}

function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const cur = out[k];
    out[k] =
      cur !== null && typeof cur === 'object' && !Array.isArray(cur) ? mergeDeep(cur, v) : v;
  }
  return out as T;
}

/**
 * chrome.storage.local, not .sync: an API key and a caption transcript should
 * not be replicated across every machine the user is signed into.
 */
export async function loadSettings(): Promise<Settings> {
  const area = storageArea();
  if (!area) {
    warnOnce();
    memoryStore ??= { ...DEFAULT_SETTINGS };
    return memoryStore;
  }
  try {
    const got = await area.get(KEY);
    return mergeDeep(DEFAULT_SETTINGS, got[KEY]);
  } catch (err) {
    // A read failure must not blank the UI — fall back to defaults and say so.
    console.error('[slb] could not read settings; using defaults for this session', err);
    memoryStore ??= { ...DEFAULT_SETTINGS };
    return memoryStore;
  }
}

export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const next = mergeDeep(await loadSettings(), patch);
  const area = storageArea();
  if (!area) {
    memoryStore = next;
    for (const l of memoryListeners) l(next);
    return next;
  }
  try {
    await area.set({ [KEY]: next });
  } catch (err) {
    console.error('[slb] could not save settings', err);
    memoryStore = next;
    for (const l of memoryListeners) l(next);
  }
  return next;
}

export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  const onChanged = (() => {
    try {
      return globalThis.chrome?.storage?.onChanged ?? null;
    } catch {
      return null;
    }
  })();

  if (!onChanged) {
    memoryListeners.add(fn);
    return () => memoryListeners.delete(fn);
  }

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !changes[KEY]) return;
    fn(mergeDeep(DEFAULT_SETTINGS, changes[KEY].newValue));
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
