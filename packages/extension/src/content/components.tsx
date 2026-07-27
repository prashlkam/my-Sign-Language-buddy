import { GAP_MARKER, type Caption } from '@slb/core';
import { useEffect, useRef, useState } from 'react';
import type { AsrState } from '../asr';
import type { PendingUtterance, SignStatus } from '../sign/pipeline';

/** Speaker colours are an accent only — every line also carries the name. */
const SPEAKER_COLOURS = ['#7cc4ff', '#a4e59a', '#ffc27a', '#e3a8ff', '#8ee6d5', '#ff9fb0'];

function colourFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SPEAKER_COLOURS[h % SPEAKER_COLOURS.length]!;
}

/** Renders gap markers distinctly so an unrecognised sign reads as a gap. */
function CaptionText({ text }: { text: string }): JSX.Element {
  const parts = text.split(GAP_MARKER);
  return (
    <span className="text">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <span className="gap" title="A sign here could not be recognised">
              {GAP_MARKER}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

export function CaptionList({
  captions,
  showConfidence,
  colourBySpeaker,
}: {
  captions: readonly Caption[];
  showConfidence: boolean;
  colourBySpeaker: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [captions, pinned]);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    // Once the user scrolls back to read something, stop yanking them to the
    // bottom on every new line.
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <div
      className="captions"
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Live captions"
    >
      {captions.length === 0 && (
        <div className="empty">
          No captions yet. Speech from the call appears here once captions are running.
        </div>
      )}
      {captions.map((c) => (
        <div key={c.id} className={`line ${c.source} ${c.interim ? 'interim' : ''}`}>
          {c.speaker?.name && (
            <span
              className="speaker"
              style={colourBySpeaker ? { color: colourFor(c.speaker.id) } : undefined}
            >
              {c.speaker.name}
            </span>
          )}
          {c.source === 'sign' && !c.speaker?.name && <span className="speaker">You (signed)</span>}
          {c.source === 'typed' && !c.speaker?.name && <span className="speaker">You (typed)</span>}
          <CaptionText text={c.text} />
          {showConfidence && c.confidence !== null && c.confidence < 0.8 && (
            <span className="conf" title="How confident the recogniser was">
              {Math.round(c.confidence * 100)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatusBar({
  asr,
  sign,
  onToggleCaptions,
  onToggleSigning,
  onOpenSettings,
}: {
  asr: AsrState | null;
  sign: SignStatus;
  onToggleCaptions: () => void;
  onToggleSigning: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  return (
    <div className="status">
      <span className={`pill ${asr?.running ? 'on' : 'off'}`}>
        <i className="dot" />
        {asr?.running ? 'Captions on' : 'Captions off'}
      </span>

      {/* Where the audio is processed is never hidden from the user. */}
      {asr?.running && (
        <span className={`pill ${asr.processing === 'cloud-google' ? 'warn' : 'on'}`}>
          {asr.processing === 'cloud-google'
            ? 'Cloud (Google)'
            : asr.processing === 'local-helper'
              ? 'On this device'
              : 'On this device'}
        </span>
      )}
      {asr?.running && asr.listeningTo === 'microphone' && (
        <span className="pill warn" title="This engine transcribes your microphone, not the other participants">
          Mic only
        </span>
      )}

      {sign.running && (
        <>
          <span className={`pill ${sign.segmenterState === 'signing' ? 'on' : 'off'}`}>
            <i className="dot" />
            {sign.segmenterState === 'signing' ? 'Reading your signs' : 'Camera ready'}
          </span>
          <span className="meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, sign.energy * 900)}%` }} />
          </span>
        </>
      )}

      <span className="spacer" />
      <button className="ghost icon" onClick={onToggleCaptions}>
        {asr?.running ? 'Stop captions' : 'Start captions'}
      </button>
      <button className="ghost icon" onClick={onToggleSigning}>
        {sign.running ? 'Stop camera' : 'Start camera'}
      </button>
      <button className="ghost icon" onClick={onOpenSettings} aria-label="Open settings">
        Settings
      </button>
    </div>
  );
}

export function ComposeBar({
  onSend,
  inputRef,
}: {
  onSend: (text: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}): JSX.Element {
  const [value, setValue] = useState('');

  const submit = (): void => {
    const text = value.trim();
    if (text === '') return;
    onSend(text);
    setValue('');
  };

  return (
    <div className="compose">
      <input
        ref={inputRef}
        value={value}
        placeholder="Type to speak into the call…"
        aria-label="Type a message to speak into the call"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Stop the page from seeing these keys — Meet and Zoom both bind
          // single letters to mute and camera toggles.
          e.stopPropagation();
          if (e.key === 'Enter') submit();
        }}
        onKeyUp={(e) => e.stopPropagation()}
      />
      <button className="primary" onClick={submit} disabled={value.trim() === ''}>
        Speak
      </button>
    </div>
  );
}

/**
 * Review-before-send (PLAN.md §3.1).
 *
 * The recognised text is shown to the person who signed it, editable, before
 * anyone else sees or hears it. They approve it, fix it, or throw it away.
 */
export function ReviewPanel({
  pending,
  onSend,
  onDiscard,
}: {
  pending: PendingUtterance;
  onSend: (text: string) => void;
  onDiscard: () => void;
}): JSX.Element {
  const [text, setText] = useState(pending.utterance.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(pending.utterance.text);
    ref.current?.focus();
    ref.current?.select();
  }, [pending.id, pending.utterance.text]);

  const lowConfidence = pending.utterance.confidence < 0.75;

  return (
    <div className="review">
      <div className="label">
        Ready to send — check this is what you meant
        {pending.via === 'llm' ? ' · phrased by Claude' : ''}
      </div>
      <textarea
        ref={ref}
        className="draft"
        value={text}
        aria-label="Recognised text, editable before sending"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend(text);
          if (e.key === 'Escape') onDiscard();
        }}
        onKeyUp={(e) => e.stopPropagation()}
      />
      {(pending.utterance.hasGaps || lowConfidence) && (
        <div className="hint" style={{ marginTop: 6 }}>
          {pending.utterance.hasGaps && `${GAP_MARKER} marks a sign that wasn't recognised. `}
          {lowConfidence && 'Confidence is low — please check it carefully.'}
        </div>
      )}
      <div className="actions">
        <button className="primary" onClick={() => onSend(text)} disabled={text.trim() === ''}>
          Send to the call
        </button>
        <button onClick={onDiscard}>Discard</button>
        <span className="hint">Ctrl+Enter to send · Esc to discard</span>
      </div>
    </div>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: 'warn' | 'danger';
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`banner ${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
