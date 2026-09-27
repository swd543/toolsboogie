/**
 * AudioWorklet for the guitar tuner.
 *
 * Accumulates 8192 samples in a ring buffer and posts each full frame to
 * the main thread (transferred, not copied). The main thread runs the
 * WASM pitch detector on the frame — the worklet itself does no DSP, so
 * it stays tiny and stable across browsers.
 */

const FRAME_SIZE = 8192;

class FrameAccumulatorNode extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(FRAME_SIZE);
    this.written = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i += 1) {
      this.buf[this.written] = ch[i];
      this.written += 1;
      if (this.written >= FRAME_SIZE) {
        const frame = this.buf.slice();
        this.port.postMessage({ type: 'frame', samples: frame }, [frame.buffer]);
        this.written = 0;
      }
    }
    return true;
  }
}

registerProcessor('frame-accumulator', FrameAccumulatorNode);
