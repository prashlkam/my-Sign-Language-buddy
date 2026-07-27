import {
  CaptionEngine,
  StablePrefixCommitter,
  latency,
  type Caption,
  type Participant,
  type PlatformAdapter,
} from '@slb/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAsrEngine, type AsrEngine, type AsrState } from '../asr';
import { detectAdapter } from '../adapters';
// Type-only: the implementation is imported lazily in startSigning() so that
// MediaPipe (and, behind it, ONNX Runtime) never load on a page where the user
// does not switch the camera on.
import type { SignPipeline, PendingUtterance, SignStatus } from '../sign/pipeline';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type Settings } from '../settings';
import { sendToBackground, type ToContent } from '../messages';
import { Banner, CaptionList, ComposeBar, ReviewPanel, StatusBar } from './components';

export function App(): JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [captions, setCaptions] = useState<readonly Caption[]>([]);
  const [asrState, setAsrState] = useState<AsrState | null>(null);
  const [signStatus, setSignStatus] = useState<SignStatus>(idleSignStatus);
  const [coach, setCoach] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingUtterance | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);

  const engine = useMemo(() => new CaptionEngine(), []);
  const adapterRef = useRef<PlatformAdapter | null>(null);
  const asrRef = useRef<AsrEngine | null>(null);
  const signRef = useRef<SignPipeline | null>(null);
  const composeRef = useRef<HTMLInputElement>(null);
  const speakerRef = useRef<Participant | null>(null);
  const committerRef = useRef(new StablePrefixCommitter(2));

  // ---- settings -----------------------------------------------------------
  useEffect(() => {
    loadSettings().then(setSettings, () => setSettings({ ...DEFAULT_SETTINGS }));
    return onSettingsChanged(setSettings);
  }, []);

  useEffect(() => {
    if (settings) signRef.current?.updateSettings(settings);
  }, [settings]);

  // ---- captions -----------------------------------------------------------
  useEffect(() => engine.subscribe(setCaptions), [engine]);

  // ---- platform adapter ---------------------------------------------------
  useEffect(() => {
    const adapter = detectAdapter();
    adapterRef.current = adapter;
    void adapter.attach().then(() => {
      const health = adapter.health();
      for (const d of health.degraded) engine.system(d.reason);
    });
    const off = adapter.onActiveSpeaker((p) => {
      speakerRef.current = p;
    });
    return () => {
      off();
      void adapter.detach();
    };
  }, [engine]);

  // ---- speech → captions --------------------------------------------------
  const startCaptions = useCallback(async () => {
    if (!settings || asrRef.current) return;

    // Rebuilt per session so a changed stability setting takes effect on the
    // next start rather than mid-utterance.
    committerRef.current = new StablePrefixCommitter(settings.asr.agreement);
    const committer = committerRef.current;

    const asr = createAsrEngine(
      settings.asr.engine,
      {
        onPartial: (text, startedAt) => {
          // Only the stable prefix is shown as settled; the rest is marked as
          // still-changing so the reader is never re-reading rewritten text.
          const { committed, draft } = committer.push(text);
          engine.upsertInterim({
            source: 'asr',
            speaker: speakerRef.current,
            text: [committed, draft].filter(Boolean).join(' '),
            startedAt,
          });
          latency.mark('rendered', startedAt);
        },
        onFinal: (text, startedAt, confidence) => {
          const { committed } = committer.finalize(text);
          engine.commit({
            source: 'asr',
            speaker: speakerRef.current,
            text: committed,
            confidence,
            startedAt,
          });
          latency.mark('rendered', startedAt);
        },
        onState: setAsrState,
      },
      settings.asr.language,
    );

    if (!asr) {
      engine.system(
        settings.asr.engine === 'off'
          ? 'Speech captions are turned off in settings.'
          : 'No speech engine is available. Check settings.',
      );
      return;
    }
    asrRef.current = asr;
    await asr.start();
  }, [engine, settings]);

  const stopCaptions = useCallback(async () => {
    await asrRef.current?.stop();
    asrRef.current = null;
    committerRef.current.reset();
    setAsrState(null);
  }, []);

  // ---- sign → text --------------------------------------------------------
  const startSigning = useCallback(async () => {
    if (!settings || signRef.current) return;

    // ~2 MB of keypoint machinery, fetched on first use only.
    const { SignPipeline } = await import('../sign/pipeline');
    if (signRef.current) return; // a second toggle raced us while loading

    const pipeline = new SignPipeline(settings, {
      onStatus: setSignStatus,
      onCoach: setCoach,
      onToken: () => {},
      onUtterance: (u) => {
        if (settings.sign.confirmBeforeSend) {
          setPending(u);
        } else {
          void deliver(u.utterance.text, u.utterance.confidence, 'sign');
        }
      },
    });
    signRef.current = pipeline;
    await pipeline.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const stopSigning = useCallback(async () => {
    signRef.current?.dispose();
    signRef.current = null;
    setSignStatus(idleSignStatus);
    setCoach([]);
    setPending(null);
  }, []);

  // ---- delivery -----------------------------------------------------------
  const deliver = useCallback(
    async (text: string, confidence: number, source: 'sign' | 'typed') => {
      const startedAt = performance.now();
      // Show it locally first: the user should see their own words even if
      // every outbound route fails.
      engine.commit({ source, speaker: null, text, confidence, startedAt });

      const adapter = adapterRef.current;
      if (!adapter) return;

      const result = await adapter.deliverOutbound(text, confidence);
      latency.mark('delivered', startedAt);

      if (!result.ok) {
        setDeliveryNote(
          result.error ??
            'Nobody else received that. It is shown here only — check your delivery settings.',
        );
      } else {
        setDeliveryNote(
          result.via === 'tts'
            ? null
            : result.via === 'zoom-cc'
              ? null
              : result.via === 'chat'
                ? 'Sent to the meeting chat.'
                : null,
        );
      }
    },
    [engine],
  );

  // ---- hotkeys ------------------------------------------------------------
  useEffect(() => {
    const listener = (msg: ToContent): void => {
      if (msg.type !== 'command') return;
      if (msg.command === 'toggle-captions') {
        void (asrRef.current ? stopCaptions() : startCaptions());
      }
      if (msg.command === 'toggle-signing') {
        void (signRef.current ? stopSigning() : startSigning());
      }
      if (msg.command === 'focus-compose') composeRef.current?.focus();
    };
    // Absent when the overlay is rendered outside an extension context.
    const onMessage = globalThis.chrome?.runtime?.onMessage;
    if (!onMessage) return;
    onMessage.addListener(listener);
    return () => onMessage.removeListener(listener);
  }, [startCaptions, stopCaptions, startSigning, stopSigning]);

  useEffect(() => () => void signRef.current?.dispose(), []);

  if (!settings || !settings.enabled) return null;

  const fontFamily =
    settings.captions.fontFamily === 'serif'
      ? 'Georgia, "Times New Roman", serif'
      : settings.captions.fontFamily === 'mono'
        ? 'ui-monospace, "SF Mono", Menlo, monospace'
        : settings.captions.fontFamily === 'opendyslexic'
          ? 'OpenDyslexic, system-ui, sans-serif'
          : 'system-ui, -apple-system, "Segoe UI", sans-serif';

  return (
    <div
      className={`root ${settings.captions.position}`}
      style={
        {
          '--slb-size': `${settings.captions.fontSizePx}px`,
          '--slb-opacity': settings.captions.opacity,
          '--slb-font': fontFamily,
        } as React.CSSProperties
      }
    >
      <div className="panel">
        <CaptionList
          captions={captions}
          showConfidence={settings.captions.showConfidence}
          colourBySpeaker={settings.captions.colourBySpeaker}
        />

        {/*
          Whenever the demo recogniser is active this banner is mandatory.
          It is not sign language recognition, and a user must never be left
          to infer that it is.
        */}
        {signStatus.running && signStatus.recognizerKind === 'demo' && (
          <Banner kind="danger">
            <strong>Demo mode — this is not sign language recognition.</strong> No trained model is
            loaded, so the camera is matching a few hand shapes only. Do not rely on it to say
            anything that matters.
          </Banner>
        )}

        {signStatus.error && <Banner kind="warn">{signStatus.error}</Banner>}
        {asrState?.error && <Banner kind="warn">{asrState.error}</Banner>}
        {coach.length > 0 && <Banner kind="warn">{coach.join(' ')}</Banner>}
        {deliveryNote && <Banner kind="warn">{deliveryNote}</Banner>}

        {pending && (
          <ReviewPanel
            pending={pending}
            onSend={(text) => {
              setPending(null);
              void deliver(text, pending.utterance.confidence, 'sign');
            }}
            onDiscard={() => setPending(null)}
          />
        )}

        <ComposeBar
          inputRef={composeRef}
          onSend={(text) => void deliver(text, 1, 'typed')}
        />

        <StatusBar
          asr={asrState}
          sign={signStatus}
          onToggleCaptions={() => void (asrRef.current ? stopCaptions() : startCaptions())}
          onToggleSigning={() => void (signRef.current ? stopSigning() : startSigning())}
          onOpenSettings={() => void sendToBackground({ type: 'options/open' })}
        />
      </div>
    </div>
  );
}

const idleSignStatus: SignStatus = {
  running: false,
  extractorReady: false,
  recognizerId: 'none',
  recognizerKind: 'demo',
  segmenterState: 'idle',
  energy: 0,
};
