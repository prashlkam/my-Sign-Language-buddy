/**
 * Overlay styles, injected into a shadow root so that neither Meet's stylesheet
 * nor ours can reach across (PLAN.md §4.4 rendering requirements).
 *
 * Caption legibility here is not decoration. The defaults follow broadcast
 * caption practice: high contrast on an opaque backing box (not a text shadow),
 * generous line height, a hard cap on line length so the eye can find the next
 * line, and no reflow of text that has already been read.
 */
export const OVERLAY_CSS = `
:host {
  --slb-bg: rgba(12, 14, 18, var(--slb-opacity, 0.92));
  --slb-fg: #f6f7f9;
  --slb-dim: #a8b0bd;
  --slb-accent: #7cc4ff;
  --slb-warn: #ffcc66;
  --slb-danger: #ff8a80;
  --slb-radius: 10px;
  all: initial;
}

* { box-sizing: border-box; }

.root {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483600;
  width: min(900px, calc(100vw - 48px));
  font-family: var(--slb-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--slb-fg);
  pointer-events: none;
}
.root.bottom { bottom: 96px; }
.root.top { top: 24px; }
.root.floating { bottom: 24px; left: 24px; transform: none; width: min(520px, 40vw); }

.panel {
  background: var(--slb-bg);
  border-radius: var(--slb-radius);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  pointer-events: auto;
  overflow: hidden;
}

/* ---- captions ---- */
.captions {
  padding: 14px 18px;
  max-height: 42vh;
  overflow-y: auto;
  scrollbar-width: thin;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.line {
  font-size: var(--slb-size, 26px);
  line-height: 1.5;
  /* ~37 characters per line is the broadcast norm; wider is measurably harder
     to read at speed. */
  max-width: 46ch;
  word-wrap: break-word;
}
.line .speaker {
  font-size: 0.62em;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--slb-dim);
  margin-right: 8px;
  /* Names are always spelled out. Colour is an accent on top, never the only
     carrier of who is speaking (WCAG 1.4.1). */
}
.line.interim .text { color: var(--slb-dim); font-style: italic; }
.line.sign .text { border-left: 3px solid var(--slb-accent); padding-left: 10px; }
.line.system .text { color: var(--slb-warn); font-size: 0.72em; }
.line .gap { color: var(--slb-warn); font-weight: 700; }
.line .conf {
  font-size: 0.55em;
  color: var(--slb-dim);
  margin-left: 8px;
  vertical-align: middle;
}
.empty { color: var(--slb-dim); font-size: 15px; padding: 6px 0; }

/* ---- status ---- */
.status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-top: 1px solid rgba(255,255,255,0.10);
  font-size: 12px;
  color: var(--slb-dim);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  white-space: nowrap;
}
.pill.on { color: #b7f3c8; border-color: rgba(120,240,160,0.45); }
.pill.off { color: var(--slb-dim); }
.pill.warn { color: var(--slb-warn); border-color: rgba(255,204,102,0.5); }
.pill.danger { color: var(--slb-danger); border-color: rgba(255,138,128,0.5); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.spacer { flex: 1 1 auto; }

/* ---- banners ---- */
.banner {
  padding: 9px 14px;
  font-size: 13px;
  line-height: 1.45;
  border-top: 1px solid rgba(255,255,255,0.10);
}
.banner.warn { background: rgba(255,204,102,0.13); color: #ffe0a3; }
.banner.danger { background: rgba(255,138,128,0.14); color: #ffc9c4; }
.banner strong { color: inherit; }

/* ---- compose / review ---- */
.compose { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.10); }
.compose input {
  flex: 1;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 8px;
  color: var(--slb-fg);
  font: inherit;
  font-size: 15px;
  padding: 9px 12px;
}
.compose input:focus { outline: 2px solid var(--slb-accent); outline-offset: 1px; }

button {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.09);
  color: var(--slb-fg);
  padding: 8px 14px;
  cursor: pointer;
}
button:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
button:focus-visible { outline: 2px solid var(--slb-accent); outline-offset: 2px; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
button.primary { background: #1f6feb; border-color: #3b82f6; color: #fff; }
button.primary:hover:not(:disabled) { background: #2b7cf3; }
button.ghost { background: transparent; }
button.icon { padding: 6px 9px; }

.review { padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.10); }
.review .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--slb-dim); margin-bottom: 6px; }
.review .draft {
  font-size: 19px;
  line-height: 1.45;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 8px;
  color: var(--slb-fg);
  font-family: inherit;
  padding: 10px 12px;
  width: 100%;
  resize: vertical;
  min-height: 56px;
}
.review .actions { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
.review .hint { font-size: 12px; color: var(--slb-dim); }

.meter { width: 60px; height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
.meter > i { display: block; height: 100%; background: var(--slb-accent); transition: width 90ms linear; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .meter > i { transition: none; }
}
`;
