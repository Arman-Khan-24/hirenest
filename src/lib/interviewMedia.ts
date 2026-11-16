import { chunksToWav } from './wav';

export interface BrowserSupport {
  ok: boolean;
  missing: string[];
}

/** The recorded interview needs camera, microphone, MediaRecorder and Web Audio. */
export function checkBrowserSupport(): BrowserSupport {
  const missing: string[] = [];
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) missing.push('camera and microphone access');
  if (typeof MediaRecorder === 'undefined') missing.push('video recording');
  const AC = (window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext ||
    (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  if (!AC) missing.push('audio processing');
  return { ok: missing.length === 0, missing };
}

export class DeviceError extends Error {
  constructor(
    message: string,
    public kind: 'denied' | 'not_found' | 'in_use' | 'unsupported' | 'other'
  ) {
    super(message);
  }
}

/** Requests BOTH camera and microphone. The interview cannot proceed with either one missing. */
export async function acquireDevices(): Promise<MediaStream> {
  const support = checkBrowserSupport();
  if (!support.ok) {
    throw new DeviceError(`This browser does not support ${support.missing.join(', ')}. Please use the latest Chrome, Edge, Firefox or Safari.`, 'unsupported');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 24 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new DeviceError('Camera or microphone access was blocked. Allow both for this site in your browser settings, then try again.', 'denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      throw new DeviceError('No camera or microphone was found. Connect one and try again.', 'not_found');
    if (name === 'NotReadableError' || name === 'AbortError')
      throw new DeviceError('Your camera or microphone is being used by another app. Close it and try again.', 'in_use');
    throw new DeviceError('Could not start your camera and microphone. Please try again.', 'other');
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function devicesLive(stream: MediaStream | null | undefined): { camera: boolean; mic: boolean } {
  const live = (t?: MediaStreamTrack) => !!t && t.readyState === 'live' && t.enabled;
  return { camera: live(stream?.getVideoTracks()[0]), mic: live(stream?.getAudioTracks()[0]) };
}

export function pickVideoMime(): string {
  const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export interface RecordedAnswer {
  video: Blob;
  /** Container type without codecs, e.g. video/webm. */
  videoMime: string;
  wav: Blob;
  seconds: number;
}

/**
 * Records ONE answer: the video (for the recruiter to review) and a 16 kHz mono WAV of the
 * microphone (for speech analysis). Both come from the same live stream.
 */
export class AnswerRecorder {
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private ctx: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private processor: ScriptProcessorNode;
  private pcm: Float32Array[] = [];
  private mime: string;
  private startedAt = 0;
  private stopped = false;

  constructor(stream: MediaStream) {
    this.mime = pickVideoMime();
    this.recorder = new MediaRecorder(stream, {
      ...(this.mime ? { mimeType: this.mime } : {}),
      videoBitsPerSecond: 250_000,
      audioBitsPerSecond: 32_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.source = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.stopped) this.pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);
  }

  async start() {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    this.startedAt = Date.now();
    this.recorder.start(1000);
  }

  elapsedSeconds(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  async stop(): Promise<RecordedAnswer> {
    this.stopped = true;
    const done = new Promise<void>((resolve) => {
      this.recorder.onstop = () => resolve();
    });
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    await done;
    this.cleanup();
    const type = this.recorder.mimeType || this.mime || 'video/webm';
    const videoMime = /mp4/i.test(type) ? 'video/mp4' : 'video/webm';
    const { wav, seconds } = chunksToWav(this.pcm, this.ctx.sampleRate);
    return {
      video: new Blob(this.chunks, { type: videoMime }),
      videoMime,
      wav: new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }),
      seconds,
    };
  }

  cancel() {
    this.stopped = true;
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* already stopped */
    }
    this.cleanup();
  }

  private cleanup() {
    try {
      this.processor.disconnect();
      this.source.disconnect();
    } catch {
      /* already disconnected */
    }
    void this.ctx.close().catch(() => undefined);
  }
}

/** Calls back with the microphone level (0..1) about 15 times a second. Returns a stop function. */
export function watchLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC || !stream.getAudioTracks().length) return () => undefined;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
  }, 66);
  return () => {
    window.clearInterval(timer);
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
    void ctx.close().catch(() => undefined);
  };
}

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/**
 * Reads text aloud. `onEnd` always fires exactly once (also when speech is unsupported or blocked),
 * so the interview can never get stuck waiting for the voice.
 */
export function speak(text: string, onStart: () => void, onEnd: () => void): () => void {
  if (!ttsSupported()) {
    onEnd();
    return () => undefined;
  }
  let finished = false;
  let started = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(guard);
    onEnd();
  };
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const voice = voices.find((v) => /^en[-_](IN|GB)/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
  u.rate = 0.95;
  u.onstart = () => {
    started = true;
    onStart();
  };
  u.onend = finish;
  u.onerror = finish;
  // Some browsers block speech without a gesture and never fire any event.
  const guard = window.setTimeout(() => {
    if (!started) finish();
  }, 2500);
  // Safety net for very long text: never wait more than ~40s.
  window.setTimeout(finish, 40_000);
  synth.speak(u);
  return () => {
    finished = true;
    window.clearTimeout(guard);
    synth.cancel();
  };
}
