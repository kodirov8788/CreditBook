import { VOICE_MAX_AUDIO_BYTES, VOICE_MAX_SECONDS } from "./voice-contract";

export type AudioBufferLike = Readonly<{ numberOfChannels: number; length: number; sampleRate: number; getChannelData(channel: number): Float32Array }>;
export type MediaTrackLike = Readonly<{ stop(): void }>;
export type MediaStreamLike = Readonly<{ getTracks(): readonly MediaTrackLike[] }>;
export type MediaRecorderLike = Readonly<{
  state: "inactive" | "recording" | "paused";
  start(): void;
  stop(): void;
  addEventListener(type: "dataavailable" | "stop" | "error", listener: (event: Event & { data?: Blob }) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: "dataavailable" | "stop" | "error", listener: (event: Event & { data?: Blob }) => void): void;
}>;
export type VoiceRecorderEnvironment = Readonly<{
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
  createMediaRecorder(stream: MediaStreamLike, options?: MediaRecorderOptions): MediaRecorderLike;
  supportsMimeType?(mimeType: string): boolean;
  createAudioContext(): Readonly<{ decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>; close(): Promise<void> }>;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(timer: number): void;
}>;

export type VoiceRecorder = Readonly<{ finished: Promise<Uint8Array>; stop(): Promise<Uint8Array>; cancel(): void }>;

const SAMPLE_RATE = 16_000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function browserEnvironment(): VoiceRecorderEnvironment {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
    throw new Error("VOICE_RECORDING_UNSUPPORTED");
  }
  return {
    getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
    createMediaRecorder: (stream, options) => new MediaRecorder(stream as MediaStream, options),
    supportsMimeType: MediaRecorder.isTypeSupported.bind(MediaRecorder),
    createAudioContext: () => new AudioContext(),
    setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
    clearTimeout: timer => window.clearTimeout(timer),
  };
}

/** Browser-only capability. Nothing accesses a microphone until this is called. */
export async function startVoiceRecorder(environment: VoiceRecorderEnvironment = browserEnvironment(), signal?: AbortSignal): Promise<VoiceRecorder> {
  if (signal?.aborted) throw new DOMException("Voice recording cancelled", "AbortError");
  const stream = await environment.getUserMedia({ audio: true });
  if (signal?.aborted) { stream.getTracks().forEach(track => track.stop()); throw new DOMException("Voice recording cancelled", "AbortError"); }
  const mimeType = MIME_TYPES.find(type => environment.supportsMimeType?.(type) ?? true);
  let recorder: MediaRecorderLike;
  try { recorder = environment.createMediaRecorder(stream, mimeType ? { mimeType } : undefined); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  let stopped = false, cancelled = false, settled = false, tracksReleased = false, listenersRemoved = false, contextClosed = false;
  let timer: number | undefined;
  const chunks: Blob[] = [];
  let resolve: ((audio: Uint8Array) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let context: Readonly<{ decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>; close(): Promise<void> }> | null = null;
  const result = new Promise<Uint8Array>((ok, fail) => { resolve = ok; reject = fail; });
  const releaseTracks = () => {
    if (tracksReleased) return;
    tracksReleased = true;
    stream.getTracks().forEach(track => track.stop());
  };
  const closeContext = () => {
    if (!context || contextClosed) return;
    contextClosed = true;
    void context.close().catch(() => undefined);
  };
  const removeListeners = () => {
    if (listenersRemoved) return;
    listenersRemoved = true;
    recorder.removeEventListener("dataavailable", onData); recorder.removeEventListener("error", onError); recorder.removeEventListener("stop", onStop);
  };
  const cleanup = () => {
    if (timer !== undefined) { environment.clearTimeout(timer); timer = undefined; }
    releaseTracks(); closeContext(); removeListeners(); chunks.length = 0;
  };
  const resolveResult = (audio: Uint8Array) => { if (!settled) { settled = true; resolve?.(audio); cleanup(); } };
  const rejectResult = (error: Error) => { if (!settled) { settled = true; reject?.(error); cleanup(); } };
  const onData = (event: Event & { data?: Blob }) => { if (event.data && event.data.size > 0) chunks.push(event.data); };
  const onError = () => rejectResult(new Error("VOICE_RECORDING_FAILED"));
  const onStop = async () => {
    releaseTracks();
    if (cancelled || settled) { cleanup(); return; }
    try {
      const encoded = await new Blob(chunks, { type: mimeType ?? "audio/webm" }).arrayBuffer();
      chunks.length = 0;
      if (cancelled || settled) { cleanup(); return; }
      context = environment.createAudioContext();
      const decoded = await context.decodeAudioData(encoded);
      if (cancelled || settled) { cleanup(); return; }
      resolveResult(canonicalWav(decoded));
    } catch { if (!cancelled) rejectResult(new Error("VOICE_AUDIO_DECODE_FAILED")); }
    finally { closeContext(); if (cancelled) cleanup(); }
  };
  const stop = async (): Promise<Uint8Array> => {
    if (!stopped) {
      stopped = true;
      releaseTracks();
      if (recorder.state !== "inactive") {
        try { recorder.stop(); }
        catch { rejectResult(new Error("VOICE_RECORDING_FAILED")); }
      }
      else rejectResult(new Error("VOICE_RECORDING_FAILED"));
    }
    return result;
  };
  try {
    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("error", onError, { once: true });
    recorder.addEventListener("stop", onStop, { once: true });
    recorder.start();
    timer = environment.setTimeout(() => { void stop().catch(() => undefined); }, VOICE_MAX_SECONDS * 1000);
  } catch (error) { cleanup(); throw error; }
  return Object.freeze({ finished: result, stop, cancel: () => {
    if (cancelled || settled) return;
    cancelled = true;
    stopped = true;
    releaseTracks(); closeContext();
    if (recorder.state !== "inactive") {
      try { recorder.stop(); }
      catch { /* cancellation already settled the result below */ }
    }
    rejectResult(new DOMException("Voice recording cancelled", "AbortError"));
  } });
}

/** Produces one canonical PCM16/mono/16 kHz WAV, including the fixed 44-byte header. */
export function canonicalWav(source: AudioBufferLike): Uint8Array {
  if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0 || source.numberOfChannels < 1 || source.length < 1) throw new Error("VOICE_AUDIO_INVALID");
  const frames = Math.floor(source.length * SAMPLE_RATE / source.sampleRate);
  if (frames < 1) throw new Error("VOICE_AUDIO_INVALID");
  const bytes = 44 + frames * 2;
  if (bytes > VOICE_MAX_AUDIO_BYTES) throw new Error("VOICE_AUDIO_TOO_LARGE");
  const output = new Uint8Array(bytes);
  const view = new DataView(output.buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes - 8, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes - 44, true);
  const channels = Array.from({ length: source.numberOfChannels }, (_, index) => source.getChannelData(index));
  for (let frame = 0; frame < frames; frame++) {
    const position = frame * source.sampleRate / SAMPLE_RATE;
    const lower = Math.min(source.length - 1, Math.floor(position));
    const upper = Math.min(source.length - 1, lower + 1);
    const weight = position - lower;
    let sample = 0;
    for (const channel of channels) sample += channel[lower] * (1 - weight) + channel[upper] * weight;
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(44 + frame * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

export function wavBase64(audio: Uint8Array): string {
  let binary = "";
  for (const byte of audio) binary += String.fromCharCode(byte);
  return btoa(binary);
}
