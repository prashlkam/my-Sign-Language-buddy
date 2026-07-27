import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../settings';
import { ErrorBoundary } from '../ui/ErrorBoundary';

/**
 * Quick toggles. Deliberately thin — the popup closes the moment you click
 * anywhere in the call, so anything you need *during* a call lives in the
 * overlay, not here.
 */
function Popup(): JSX.Element {
  const [s, setS] = useState<Settings | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    loadSettings().then(setS, () => setS({ ...DEFAULT_SETTINGS }));

    // chrome.tabs is absent outside the extension; don't let that blank the popup.
    const tabs = globalThis.chrome?.tabs;
    if (!tabs) return;
    tabs.query({ active: true, currentWindow: true }).then(
      ([tab]) => setSupported(/meet\.google\.com|zoom\.us/.test(tab?.url ?? '')),
      () => setSupported(true),
    );
  }, []);

  if (!s) return <p>Loading…</p>;

  const update = (patch: Parameters<typeof saveSettings>[0]): void => {
    void saveSettings(patch).then(setS);
  };

  return (
    <>
      <h1>Sign Language Buddy</h1>

      {!supported && (
        <p className="hint">
          This tab isn’t a Zoom or Meet call. Captions run on <b>meet.google.com</b> and{' '}
          <b>zoom.us</b>.
        </p>
      )}

      <div className="row">
        <span>Overlay</span>
        <input
          type="checkbox"
          checked={s.enabled}
          aria-label="Show the caption overlay"
          onChange={(e) => update({ enabled: e.target.checked })}
        />
      </div>

      <div className="row">
        <span>Sign language</span>
        <select
          value={s.signLanguage}
          onChange={(e) => update({ signLanguage: e.target.value as Settings['signLanguage'] })}
        >
          <option value="asl">ASL</option>
          <option value="bsl">BSL</option>
        </select>
      </div>

      <div className="row">
        <span>Review before sending</span>
        <input
          type="checkbox"
          checked={s.sign.confirmBeforeSend}
          aria-label="Review recognised text before sending"
          onChange={(e) => update({ sign: { confirmBeforeSend: e.target.checked } })}
        />
      </div>

      <button onClick={() => void globalThis.chrome?.runtime?.openOptionsPage?.()}>
        All settings
      </button>

      <p className="hint">
        <kbd>Ctrl+Shift+C</kbd> captions · <kbd>Ctrl+Shift+S</kbd> camera ·{' '}
        <kbd>Ctrl+Shift+K</kbd> type to speak
      </p>
    </>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <ErrorBoundary surface="popup" compact>
      <Popup />
    </ErrorBoundary>,
  );
}
