import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  settingsArePersistent,
  type Settings,
} from '../settings';
import { listVoices, speak } from '../delivery/tts';
import { ErrorBoundary } from '../ui/ErrorBoundary';

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="row">
      <label className="label">
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * The one-time notice (PLAN.md §11).
 *
 * It appears on first run and stays until acknowledged. The wording is
 * deliberate: this tool is for everyday meetings, and saying so once, plainly,
 * is the difference between a useful aid and something a person leans on in a
 * medical appointment because nobody told them not to.
 */
function Notice({ onAcknowledge }: { onAcknowledge: () => void }): JSX.Element {
  return (
    <div className="notice danger">
      <h3>Before you use this</h3>
      <p>
        This is a communication aid for everyday calls — standups, catch-ups, informal meetings.
        It is <b>not an interpreter</b> and it is not a substitute for one.
      </p>
      <ul>
        <li>
          Do not rely on it for anything consequential: medical appointments, legal or financial
          matters, employment decisions, or emergencies. Book a qualified interpreter for those.
        </li>
        <li>
          Sign recognition is early and often wrong. Everything it produces is shown to you for
          review before anyone else sees it, and that step is on by default for good reason.
        </li>
        <li>
          <code>[…]</code> in a caption means a sign was not recognised. It is a real gap, not a
          formatting artefact — nothing is quietly filled in for you.
        </li>
      </ul>
      <button className="primary" onClick={onAcknowledge}>
        I understand
      </button>
    </div>
  );
}

function Options(): JSX.Element {
  const [s, setS] = useState<Settings | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    // Never let a settings or voice-list failure leave the page empty.
    loadSettings().then(setS, () => setS({ ...DEFAULT_SETTINGS }));
    listVoices().then(setVoices, () => setVoices([]));
  }, []);

  if (!s) return <p>Loading…</p>;

  const update = (patch: Parameters<typeof saveSettings>[0]): void => {
    void saveSettings(patch).then(setS);
  };

  const requestClaudeAccess = async (): Promise<void> => {
    // Absent when previewing outside the extension; the toggle should still work.
    const perms = globalThis.chrome?.permissions;
    if (!perms) {
      update({ cloud: { glossBackend: 'claude' } });
      return;
    }
    const granted = await perms.request({ origins: ['https://api.anthropic.com/*'] });
    if (granted) update({ cloud: { glossBackend: 'claude' } });
  };

  return (
    <>
      <h1>Sign Language Buddy</h1>
      <p className="sub">Two-way captions for Zoom and Google Meet.</p>

      {!settingsArePersistent() && (
        <div className="notice warn">
          <p style={{ margin: 0 }}>
            <b>Preview mode.</b> Extension storage isn’t available on this page, so changes apply
            for this session only and won’t be saved. Open this page from{' '}
            <code>chrome://extensions</code> to change settings for real.
          </p>
        </div>
      )}

      {s.onboardingAcknowledgedAt === null && (
        <Notice onAcknowledge={() => update({ onboardingAcknowledgedAt: Date.now() })} />
      )}

      <section>
        <h2>Speech → captions</h2>
        <Row
          title="Speech engine"
          hint="Where the other participants' words are turned into text."
        >
          <select
            value={s.asr.engine}
            onChange={(e) => update({ asr: { engine: e.target.value as Settings['asr']['engine'] } })}
          >
            <option value="web-speech">Web Speech (no install, cloud)</option>
            <option value="helper">Desktop helper (on this device)</option>
            <option value="off">Off</option>
          </select>
        </Row>

        {s.asr.engine === 'web-speech' && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <p style={{ margin: 0 }}>
              <b>Two things to know about this engine.</b> Chrome sends the audio to Google for
              recognition, so it is not on-device. And it listens to your <b>microphone</b>, not to
              the other participants — to caption them, route the call audio into your microphone
              with a loopback device, or use the desktop helper instead.
            </p>
          </div>
        )}

        {s.asr.engine === 'helper' && (
          <>
            <Row title="Helper port" hint="Loopback only — 127.0.0.1.">
              <input
                type="number"
                value={s.asr.helperPort}
                onChange={(e) => update({ asr: { helperPort: Number(e.target.value) } })}
              />
            </Row>
            <Row title="Helper token" hint="Shared secret printed by the helper on startup.">
              <input
                type="password"
                value={s.asr.helperToken}
                onChange={(e) => update({ asr: { helperToken: e.target.value } })}
              />
            </Row>
          </>
        )}

        <Row
          title="Stability"
          hint="How many passes must agree before a word stops changing. Higher is steadier but slower."
        >
          <select
            value={s.asr.agreement}
            onChange={(e) => update({ asr: { agreement: Number(e.target.value) } })}
          >
            <option value={1}>1 — fastest, flickers</option>
            <option value={2}>2 — recommended</option>
            <option value={3}>3 — steadiest</option>
          </select>
        </Row>
      </section>

      <section>
        <h2>Caption appearance</h2>
        <Row title="Text size">
          <input
            type="range"
            min={16}
            max={48}
            value={s.captions.fontSizePx}
            onChange={(e) => update({ captions: { fontSizePx: Number(e.target.value) } })}
          />
        </Row>
        <Row title="Typeface">
          <select
            value={s.captions.fontFamily}
            onChange={(e) =>
              update({ captions: { fontFamily: e.target.value as Settings['captions']['fontFamily'] } })
            }
          >
            <option value="system">System</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
            <option value="opendyslexic">OpenDyslexic (if installed)</option>
          </select>
        </Row>
        <Row title="Position">
          <select
            value={s.captions.position}
            onChange={(e) =>
              update({ captions: { position: e.target.value as Settings['captions']['position'] } })
            }
          >
            <option value="bottom">Bottom</option>
            <option value="top">Top</option>
            <option value="floating">Floating (corner)</option>
          </select>
        </Row>
        <Row title="Background opacity">
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.02}
            value={s.captions.opacity}
            onChange={(e) => update({ captions: { opacity: Number(e.target.value) } })}
          />
        </Row>
        <Row title="Show confidence" hint="Marks captions the recogniser was unsure about.">
          <input
            type="checkbox"
            checked={s.captions.showConfidence}
            onChange={(e) => update({ captions: { showConfidence: e.target.checked } })}
          />
        </Row>
      </section>

      <section>
        <h2>Signing → the call</h2>
        <Row title="Sign language" hint="ASL and BSL are different languages, not settings of one.">
          <select
            value={s.signLanguage}
            onChange={(e) => update({ signLanguage: e.target.value as Settings['signLanguage'] })}
          >
            <option value="asl">American Sign Language</option>
            <option value="bsl">British Sign Language (no model yet)</option>
          </select>
        </Row>
        <Row
          title="Review before sending"
          hint="Show recognised text to you first. Strongly recommended."
        >
          <input
            type="checkbox"
            checked={s.sign.confirmBeforeSend}
            onChange={(e) => update({ sign: { confirmBeforeSend: e.target.checked } })}
          />
        </Row>
        <Row
          title="Abstain below"
          hint="Confidence under this shows a gap instead of a guess."
        >
          <input
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={s.sign.abstainBelow}
            onChange={(e) => update({ sign: { abstainBelow: Number(e.target.value) } })}
          />
        </Row>
        <Row
          title="Recogniser model"
          hint="URL of an ONNX model. Empty means demo heuristics only — not sign recognition."
        >
          <input
            type="text"
            placeholder="https://…/model.onnx"
            value={s.sign.modelUrl}
            onChange={(e) => update({ sign: { modelUrl: e.target.value } })}
          />
        </Row>
        <Row title="Camera framing tips" hint="Tells you when your hands leave the frame.">
          <input
            type="checkbox"
            checked={s.sign.showFramingCoach}
            onChange={(e) => update({ sign: { showFramingCoach: e.target.checked } })}
          />
        </Row>
      </section>

      <section>
        <h2>Voice</h2>
        <Row title="Voice" hint="This is how you sound to the call. Your choice.">
          <select
            value={s.delivery.ttsVoiceUri ?? ''}
            onChange={(e) => update({ delivery: { ttsVoiceUri: e.target.value || null } })}
          >
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </Row>
        <Row title="Speed">
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={s.delivery.ttsRate}
            onChange={(e) => update({ delivery: { ttsRate: Number(e.target.value) } })}
          />
        </Row>
        <Row title="Preview" hint="Hear it before anyone else does.">
          <button onClick={() => void speak('This is how I will sound in the call.')}>
            Play sample
          </button>
        </Row>
        <Row
          title="Zoom caption URL"
          hint="From the host: Closed Caption → third-party service → copy API token."
        >
          <input
            type="text"
            placeholder="https://wmcc.zoom.us/closedcaption?id=…"
            value={s.delivery.zoomCcUrl}
            onChange={(e) => update({ delivery: { zoomCcUrl: e.target.value } })}
          />
        </Row>
      </section>

      <section>
        <h2>Wording of recognised signs</h2>
        <Row
          title="Assembler"
          hint="How recognised signs become English sentences."
        >
          <select
            value={s.cloud.glossBackend}
            onChange={(e) => {
              const v = e.target.value as Settings['cloud']['glossBackend'];
              if (v === 'claude') void requestClaudeAccess();
              else update({ cloud: { glossBackend: v } });
            }}
          >
            <option value="rule-based">Literal, on this device</option>
            <option value="claude">Claude API (sends signs only)</option>
          </select>
        </Row>
        {s.cloud.glossBackend === 'claude' && (
          <>
            <div className="notice warn" style={{ marginTop: 12 }}>
              <p style={{ margin: 0 }}>
                Only the recognised sign labels are sent — never video, audio, or keypoints.
                Whatever comes back is checked against the signs you actually made, and rejected if
                it contains anything you didn't sign.
              </p>
              <p style={{ marginTop: 8, marginBottom: 0 }}>
                <b>About the key:</b> it is stored in this browser profile. Anything with access to
                your extensions can read it. Use a key scoped to this purpose, and prefer the
                desktop helper if you have it.
              </p>
            </div>
            <Row title="API key">
              <input
                type="password"
                value={s.cloud.anthropicApiKey}
                placeholder="sk-ant-…"
                onChange={(e) => update({ cloud: { anthropicApiKey: e.target.value } })}
              />
            </Row>
            <Row title="Model">
              <select
                value={s.cloud.claudeModel}
                onChange={(e) => update({ cloud: { claudeModel: e.target.value } })}
              >
                <option value="claude-sonnet-5">Claude Sonnet 5 (balanced)</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (fastest)</option>
                <option value="claude-opus-5">Claude Opus 5 (most capable)</option>
              </select>
            </Row>
          </>
        )}
      </section>

      <section>
        <h2>Privacy</h2>
        <Row
          title="Keep caption history"
          hint="Off means captions live in the tab only and are gone when it closes."
        >
          <input
            type="checkbox"
            checked={s.privacy.persistHistory}
            onChange={(e) => update({ privacy: { persistHistory: e.target.checked } })}
          />
        </Row>
        <Row title="Reset everything">
          <button onClick={() => update(DEFAULT_SETTINGS)}>Restore defaults</button>
        </Row>
      </section>
    </>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <ErrorBoundary surface="settings page">
      <Options />
    </ErrorBoundary>,
  );
}
