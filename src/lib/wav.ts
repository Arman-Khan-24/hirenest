/**
 * Pure helpers that turn raw microphone samples into a 16 kHz mono 16-bit WAV.
 * WAV is accepted by every speech model and needs no codec support in the server.
 */

/** Averages source samples into each output sample. Returns the input untouched when it is already <= target. */
export function downsample(input: Float32Array, inputRate: number, targetRate = 16000): { data: Float32Array; rate: number } {
  if (inputRate <= targetRate) return { data: input, rate: inputRate };
  const ratio = inputRate / targetRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return { data: out, rate: targetRate };
}

export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

/** Joins recorded chunks, downsamples to 16 kHz and encodes them. */
export function chunksToWav(chunks: Float32Array[], inputRate: number): { wav: Uint8Array; seconds: number } {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    joined.set(c, off);
    off += c.length;
  }
  const { data, rate } = downsample(joined, inputRate);
  return { wav: encodeWav(floatTo16BitPCM(data), rate), seconds: rate ? data.length / rate : 0 };
}
