# Sign Language Buddy

Two-way live captioning for Zoom and Google Meet, built against [PLAN.md](PLAN.md).

- **Speech → captions.** The call's audio becomes readable, low-latency, non-flickering captions in front of the Deaf or Hard-of-Hearing user.
- **Text/sign → the call.** The user types (or, eventually, signs) and it reaches the other participants as native Zoom captions, as synthesised speech, or in chat.

**This is not an interpreter and it is not a replacement for one.** It is for standups, catch-ups and informal calls. For medical, legal, employment or emergency conversations, book a qualified interpreter. That notice is in the product too, not just here.

---

## What actually works right now

Honesty about state matters more than a feature list, so:

| Capability | State | Notes |
|---|---|---|
| Caption overlay (shadow DOM, WCAG-conscious typography, scrollback, speaker colours + names) | **Working** | Renders on Meet and Zoom web |
| Stable-prefix streaming (captions don't flicker or rewrite themselves) | **Working, tested** | `StablePrefixCommitter`, local-agreement-2 |
| Caption engine (interim/commit, per-speaker merge, ring buffer) | **Working, tested** | 38 unit tests |
| Speech → text via Web Speech | **Working** | ⚠️ cloud (Google) and **microphone only** — see below |
| Speech → text via desktop helper (local faster-whisper, call audio) | **Written, unverified** | Extension side complete; `packages/desktop/helper.py` has never been run against a live call |
| Type-to-speak into the call | **Working** | Speaks locally; reaching the call needs a virtual mic (not built) |
| Zoom third-party closed captions | **Written, untested** | Needs a host-provided caption URL to exercise |
| Meet chat fallback | **Written, unverified selectors** | Meet's DOM is obfuscated; see below |
| Keypoint extraction (MediaPipe hands + pose, normalised) | **Working** | Models fetched by `npm run fetch-models` |
| Signing-activity segmentation | **Working** | Hysteresis + minimum duration, hotkey-gated by default |
| **Sign language recognition** | **Not built** | See below. This is the honest headline. |
| Gloss → English + fabrication guard | **Working, tested** | Rule-based and Claude paths, both guarded |
| Review-before-send | **Working** | On by default |
| Signing avatar | **Not started** | Research track — PLAN.md §13 |

### The three things you should not misread

**1. There is no sign language recognition in this build.** The pipeline runs end to end — camera → keypoints → segmentation → gloss → English → delivery — but the recogniser slotted into it is `DemoGestureRecognizer`, which counts extended fingers and checks whether a fingertip is near your chest. It knows about six hand shapes. ASL is not a set of hand shapes; its grammar lives in movement, space and the face. Training a real recogniser is M3/M4 in the plan and needs data, weights, and the signer-independent evaluation in §8 before anyone should trust a word of it. The runtime contract for a real ONNX model is implemented and documented in `sign/recognizer/onnx.ts`; dropping in weights is a settings change.

The UI shows a red "not sign language recognition" banner whenever the demo recogniser is active. Don't remove it.

**2. Web Speech is not the private path.** Chrome streams that audio to Google, and it listens to your *microphone*, not to the other participants — which is the wrong direction for a Deaf user who wants to read what others are saying. It is there because it needs no install and demonstrates the caption pipeline immediately. The status bar labels it `Cloud (Google)` and `Mic only` while it runs. The desktop helper is the engine that delivers local processing of the call's audio.

**3. The Meet and Zoom DOM selectors are unverified.** They are written against ARIA roles and labels rather than obfuscated class names, which makes them more durable but not durable. They have not been run against a live call. Each adapter reports `health()`, and the overlay tells the user which routes are actually working rather than failing silently.

---

## Install and run

```bash
npm install && npm run fetch-models && npm run build
```

Then load it: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `packages/extension/dist`.

Join a Meet or Zoom call and the overlay appears at the bottom of the page.

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+C` | Captions on/off |
| `Ctrl+Shift+S` | Camera (sign pipeline) on/off |
| `Ctrl+Shift+K` | Focus type-to-speak |

Optional local transcription:

```bash
pip install -r packages/desktop/requirements.txt && python packages/desktop/helper.py
```

Paste the token it prints into the extension's settings and switch the speech engine to **Desktop helper**.

### Development

```bash
npm run check
```

Typecheck, tests, build, and a manifest pre-flight that catches missing files before Chrome does. `npm run dev` rebuilds on change (reload the extension in `chrome://extensions` to pick it up).

**Previewing the settings and popup pages** without loading the extension:

```bash
python3 -m http.server 5599 --directory packages/extension/dist
```

Then open `http://localhost:5599/options.html` or `/popup.html`. Extension APIs are absent there, so the pages run in **preview mode** — settings apply in memory for the session and a banner says so. Open the HTML from `packages/extension/dist`, never from `public/`: `public/` is source, and the bundled `options.js` only exists after a build.

---

## Layout

```
packages/core/        Platform-agnostic logic, fully unit-tested
  caption-engine.ts     Interim/commit lines, per-speaker merge, ring buffer
  stable-prefix.ts      Local-agreement-n commit policy — why captions don't flicker
  gloss.ts              Gloss → English, and the fabrication guard
  lexicon.ts            Seed vocabulary (provisional — belongs to Deaf co-designers)
  adapter.ts            The platform seam
  protocol.ts           Extension ↔ desktop helper wire protocol
  latency.ts            End-to-end instrumentation (signal-in → pixel-on-screen)

packages/extension/   Chrome MV3
  adapters/             meet, zoom-web, generic — one file per platform's churn
  asr/                  Web Speech and desktop-helper engines
  sign/                 Keypoints, segmentation, recognisers, pipeline
  delivery/             TTS, Zoom CC
  content/              Shadow-DOM overlay (React)
  background/           Tab capture, offscreen lifecycle, Zoom CC, Claude proxy
  offscreen/            Tab audio → 16 kHz PCM → helper socket

packages/desktop/     Reference helper (Python, unverified)
tools/verify-dist.mjs Manifest pre-flight
```

Further reading: [docs/architecture.md](docs/architecture.md), [docs/privacy.md](docs/privacy.md), [docs/limitations.md](docs/limitations.md).

---

## Two design decisions worth knowing about

**Review-before-send is the default, and that is not timidity.** With realistic recognition accuracy, auto-sending would mean broadcasting a machine's guess about what a Deaf person said, in their name, to their colleagues. The user sees the recognised text, edits it if they want, and approves it. They stay in control of their own words.

**The gloss→English step is guarded, not just prompted.** Anything good at producing fluent English is equally good at producing fluent English the person never signed. `validateAssembly` checks every content word in a candidate sentence against the signs that licensed it and rejects anything unsupported, falling back to literal assembly. Function words are free; pronouns and content words are not — adding "she" invents a referent. Prompt instructions are a request; the guard is an enforcement point. See `gloss.test.ts` for what it catches.

---

## Not done

Beyond the status table: no virtual camera or microphone (M2), no trained recogniser (M3/M4), no fingerspelling decoder, no BSL model, no Zoom Apps SDK panel, no telemetry, no packaged release. `MEETING_LEXICON_BSL` is deliberately empty — translating the ASL list would bake in exactly the mistake PLAN.md §4.2 warns about.

The plan's §11 requirement — paid Deaf co-designers with decision authority over vocabulary, UX and confidence presentation — is not something code can satisfy, and nothing here should be taken as a substitute for it.
