# Architecture

Implementation notes for [PLAN.md](../PLAN.md) §3–§5. This describes what is
built; the plan describes what is intended.

## The asymmetry that shapes everything

The two directions have opposite delivery problems, and almost every structural
decision follows from it.

**Speech → text** has to reach exactly one person: the DHH user, on their own
machine, in a surface we control completely. It is a rendering problem.

**Sign/text → the call** has to reach *everyone else*, and neither Zoom nor Meet
offers a documented, universally available way for a local application to put
text into other participants' clients. It is a delivery problem, and it is the
harder one.

So outbound routes are ranked per platform, in `PlatformAdapter.deliverOutbound`:

| Platform | First choice | Fallbacks |
|---|---|---|
| Zoom | Third-party closed-caption API — native captions for everyone, on every client | TTS → virtual mic; chat |
| Meet | TTS → virtual mic (nothing to install for anyone else; Meet's own captions then transcribe it) | chat; overlay only |
| Anything else | TTS → virtual mic | overlay only |

The TTS-into-a-virtual-microphone route is the one that needs no vendor's
permission and cannot be revoked by a release. `GenericAdapter` is therefore a
peer of the platform adapters, not a degraded mode.

## Process layout

MV3 splits the extension across four contexts, and the split is forced rather
than chosen:

```
content script (page)          service worker              offscreen document
─────────────────────          ──────────────              ──────────────────
overlay UI (shadow DOM)   ←→   tab capture orchestration
caption engine                 offscreen lifecycle
platform adapter               Zoom CC POST (cross-origin)
camera → keypoints             Claude proxy (keeps the key   tab audio → 16 kHz PCM
segmentation → gloss           out of the page)              WebSocket → helper
Web Speech engine              global hotkeys
```

Three things could not go where you would first put them:

- **Tab audio capture** needs `chrome.tabCapture`, which the content script
  cannot call. The service worker gets the stream ID; the offscreen document
  holds the actual `MediaStream`, because a service worker has no DOM and is
  killed aggressively.
- **The helper WebSocket lives in the offscreen document, not the service
  worker.** Audio frames would otherwise cross `chrome.runtime` messaging,
  which JSON-serialises typed arrays into objects with numeric keys — roughly a
  10× blowup on the hottest path in the app.
- **Captured tab audio is played back locally.** `tabCapture` mutes the tab for
  the user; without the passthrough in `offscreen.ts` the call goes silent for
  anyone with residual hearing.

## Why captions don't flicker

Streaming ASR revises its own output constantly. Rendering each hypothesis
verbatim gives captions that rewrite themselves mid-word — exhausting to read,
and the most common way streaming caption UIs fail the people using them.

`StablePrefixCommitter` implements local-agreement-*n*: a word is committed only
once the last *n* hypotheses agree on it (default 2). Committed text is
append-only and never mutates. The unstable tail renders in a visually distinct
draft style, so the reader knows what may still change.

If the ASR contradicts something already committed, we keep what the user has
already read and count a divergence in diagnostics. Rewriting history is worse
than a small inconsistency.

## Build

esbuild directly, not Vite + a CRX plugin. MV3 content scripts cannot be ES
modules, but we want code splitting so MediaPipe and ONNX Runtime load only when
the camera is switched on. The standard resolution is a tiny IIFE stub named in
the manifest that dynamic-imports the real ESM entry from
`web_accessible_resources`:

```
content-loader.js  163 B    ← the manifest points here
  └─ content/main.js  166 kB   overlay + captions
       └─ pipeline-*.js  143 kB   MediaPipe, on first camera use
            └─ ort.bundle-*.js  396 kB   ONNX Runtime, only with a real model
```

Two output formats from one source tree: three lines in `scripts/build.mjs`, or
a fight with a bundler plugin.

## Extension points

New platform → implement `PlatformAdapter`, add to `detectAdapter()`, add host
permissions. Nothing else changes.

New recogniser → implement `SignRecognizer`. `recognise()` returning `null` or
an `UNCLEAR` token is expected and supported throughout.

New ASR engine → implement `AsrEngine`, emitting *whole-utterance hypotheses*
rather than deltas. The stable-prefix policy is applied centrally, so every
engine inherits the same non-flickering behaviour.
