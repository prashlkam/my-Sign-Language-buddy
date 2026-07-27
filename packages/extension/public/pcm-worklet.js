/**
 * Converts the captured call audio to the PCM16 frames the desktop helper's
 * ASR expects, and posts them to the offscreen document.
 *
 * The AudioContext is created at 16 kHz, so the browser has already resampled
 * for us and this only has to change the sample format. Doing the conversion in
 * an AudioWorklet keeps it off the main thread — a glitch here would show up as
 * dropped audio in the transcript, which is exactly the kind of failure that is
 * invisible to a hearing developer and ruinous for the person reading.
 */
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~64 ms per message at 16 kHz. Small enough for low latency, large enough
    // that we are not posting thousands of tiny messages per second.
    this.frameSize = 1024;
    this.buffer = new Int16Array(this.frameSize);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.offset === this.frameSize) {
        // Transfer rather than copy; the buffer is reallocated immediately.
        const out = this.buffer;
        this.port.postMessage(out.buffer, [out.buffer]);
        this.buffer = new Int16Array(this.frameSize);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
