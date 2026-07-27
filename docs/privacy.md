# Privacy

What this build actually does with your data — not what it aspires to.
Corresponds to [PLAN.md](../PLAN.md) §10.

## Video

**Never leaves the device, and is never stored.** Camera frames go to MediaPipe,
which returns landmark coordinates, and the frames are discarded immediately.
Nothing writes them to disk, and no network path can reach them.

What is retained in memory is a stream of normalised coordinates: 21 points per
hand, 33 body points. That is not a face image and not a biometric template —
there is no face recognition, no embedding, and no identification anywhere in
this codebase. This is a hard product constraint, not a default, and it is a
large part of why the pipeline is keypoint-based rather than pixel-based.

## Audio

Depends on which engine you choose, and the status bar says which is running:

| Engine | Where audio goes | What it hears |
|---|---|---|
| **Web Speech** | **Google's servers** — Chrome streams it out | Your microphone only |
| **Desktop helper** | Loopback socket to `127.0.0.1` | The call's audio |
| **Off** | Nowhere | Nothing |

Web Speech is not the private option and the UI never implies it is: it is
labelled `Cloud (Google)` and `Mic only` while running, the settings page
explains both, and the first-run notice covers it.

The helper binds `127.0.0.1` and must never bind anything routable — that would
put a live feed of your meetings on the network.

## Text

Caption history is **in memory only** by default and dies with the tab. Nothing
is persisted unless you turn on "Keep caption history".

There is no recording feature. Recording other participants has consent
implications in two-party-consent jurisdictions, and a caption tool should not
quietly become a recording tool.

## The optional Claude path

Off by default. When enabled:

- **Only the recognised gloss labels are sent** — e.g. `ME QUESTION HAVE`. Never
  video, never audio, never keypoints, never timestamps, never identifiers.
- Network access to `api.anthropic.com` is an *optional* host permission,
  requested at the moment you enable the feature and not before.
- The request is made from the service worker, so the API key never enters the
  page context where a compromised call page could reach it.
- Whatever comes back is checked by `validateAssembly` before anyone sees it.
  The API is treated as a transport, not as something trusted to have obeyed its
  own prompt.

**About the key.** It is stored in `chrome.storage.local`. Anything with access
to your extensions can read it. Use a key scoped to this purpose. The settings
page says this where you enter it.

## Storage

`chrome.storage.local`, deliberately not `.sync` — an API key and a caption
transcript should not replicate to every machine you are signed into.

## Telemetry

None. The setting exists and is off; no code sends anything anywhere.

## Not yet done

- **DPIA.** PLAN.md §10 requires one before beta (GDPR Art. 9 —
  biometric-adjacent processing). Not written.
- **Deletion pipeline** for any future data collection: not built, and §7
  requires it to be tested with a documented SLA before collection begins.
- **Third-party review** of these claims. They are accurate as far as the code
  goes, and the code is what you should check.
