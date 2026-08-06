class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input) return true;

    // Keep the graph alive; the caller routes this through a zero-gain node.
    if (output) output.set(input);
    const samples = input.slice();
    this.port.postMessage({ type: "audio", samples }, [samples.buffer]);
    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
