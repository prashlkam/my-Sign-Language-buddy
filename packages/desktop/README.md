# Desktop helper

Optional. The extension works without it — but only with the Web Speech engine,
which sends audio to Google and listens to your microphone rather than to the
other participants. This helper is what makes the two things the plan actually
promises true at the same time: **the call's audio**, transcribed **on your own
machine**.

## Status

⚠️ **Unverified.** `helper.py` implements the protocol in
`packages/core/src/protocol.ts` and a reasonable streaming policy, but it has
not been run end to end against the extension in a live call. Expect to debug
it. The endpointing thresholds (`Config.endpoint_silence_s`, `silence_rms`) are
guesses and want tuning against real meeting audio.

Not implemented at all: the **virtual microphone** and **virtual camera**. Those
are M2 in `PLAN.md` and need platform-specific plumbing — PipeWire or a null
sink on Linux, OBS VirtualCam elsewhere. Until they exist, text-to-speech comes
out of your speakers rather than into the call, which is enough to test with but
is not delivery.

## Run it

```bash
pip install -r requirements.txt
```

```bash
python packages/desktop/helper.py
```

It prints a token on startup. Paste that into the extension's settings, set the
speech engine to **Desktop helper**, and the port if you changed it.

## Why it exists

A browser extension cannot run faster-whisper, cannot open a virtual audio
device, and cannot reach the system audio graph. Everything that needs the
operating system lives here; everything else stays in the extension so that
someone who only wants Meet captions can install nothing at all.

The socket binds `127.0.0.1` and nothing else. It must stay that way — binding a
routable interface would publish a live feed of the user's meetings.

## Model choice

`large-v3-turbo` at `int8` is the default: near-large accuracy at roughly a
quarter of the compute, which matters because this runs *next to* a video call
that is already using the machine. Smaller options if it struggles:

```bash
python packages/desktop/helper.py --model distil-large-v3 --compute-type int8
```

On a CUDA machine, `--device cuda --compute-type float16` is substantially
faster.
