/**
 * Recording from the computer (ADR 0068): the camera, the screen, or the microphone alone, with
 * the microphone's sound added to a screen recording. The browser asks the person's permission
 * each time; nothing is recorded before they choose Record, and the stream is released as soon
 * as recording stops. What the person records is uploaded as an ordinary file of their
 * organisation and never leaves it.
 */

import { recorderMimeType } from "./engine";

export type CaptureMode = "camera" | "screen" | "microphone";

export interface Capture {
  stream: MediaStream;
  /** Stops every track and the mixing audio context. */
  release: () => void;
}

/** Which label explains why a capture could not start (see `labels.ts`). */
export function captureProblemKey(error: unknown): "captureDenied" | "captureNotFound" | "captureBusy" | "captureFailed" {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "captureDenied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "captureNotFound";
  if (name === "NotReadableError") return "captureBusy";
  return "captureFailed";
}

export function captureSupported(mode: CaptureMode): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return false;
  if (mode === "screen") return typeof navigator.mediaDevices.getDisplayMedia === "function";
  return typeof navigator.mediaDevices.getUserMedia === "function";
}

export async function openCapture(mode: CaptureMode, withMicrophone = true): Promise<Capture> {
  const media = navigator.mediaDevices;
  if (mode === "camera") {
    const stream = await media.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
    return { stream, release: () => stream.getTracks().forEach((t) => t.stop()) };
  }
  if (mode === "microphone") {
    const stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    return { stream, release: () => stream.getTracks().forEach((t) => t.stop()) };
  }
  const screen = await media.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
  let microphone: MediaStream | null = null;
  if (withMicrophone) {
    try {
      microphone = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      microphone = null; // a screen recording without a voice is still useful
    }
  }
  const sources = [screen, microphone].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
  if (sources.length < 2) {
    const tracks = [...screen.getVideoTracks(), ...(sources[0]?.getAudioTracks() ?? [])];
    return { stream: new MediaStream(tracks), release: () => [screen, microphone].forEach((s) => s?.getTracks().forEach((t) => t.stop())) };
  }
  // the system's sound and the microphone, mixed into one audio track
  const context = new AudioContext();
  const mix = context.createMediaStreamDestination();
  for (const source of sources) context.createMediaStreamSource(source).connect(mix);
  const stream = new MediaStream([...screen.getVideoTracks(), ...mix.stream.getAudioTracks()]);
  return {
    stream,
    release: () => {
      [screen, microphone].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
      void context.close();
    },
  };
}

export interface Recording {
  blob: Blob;
  durationMs: number;
  kind: "video" | "audio";
  mimeType: string;
}

export class Recorder {
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedFor = 0;
  private pausedAt = 0;
  private kind: "video" | "audio";

  constructor(private capture: Capture) {
    this.kind = capture.stream.getVideoTracks().length ? "video" : "audio";
    const mimeType = recorderMimeType(this.kind === "video");
    this.recorder = new MediaRecorder(capture.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
  }

  start(): void {
    this.startedAt = performance.now();
    this.recorder.start(1000);
  }

  pause(): void {
    if (this.recorder.state !== "recording") return;
    this.recorder.pause();
    this.pausedAt = performance.now();
  }

  resume(): void {
    if (this.recorder.state !== "paused") return;
    this.recorder.resume();
    this.pausedFor += performance.now() - this.pausedAt;
  }

  get state(): RecordingState {
    return this.recorder.state;
  }

  elapsedMs(): number {
    const end = this.recorder.state === "paused" ? this.pausedAt : performance.now();
    return Math.max(0, end - this.startedAt - this.pausedFor);
  }

  stop(): Promise<Recording> {
    const durationMs = this.elapsedMs();
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.capture.release();
        resolve({ blob: new Blob(this.chunks, { type: (this.recorder.mimeType || "video/webm").split(";")[0] }), durationMs, kind: this.kind, mimeType: this.recorder.mimeType });
      };
      if (this.recorder.state === "inactive") this.recorder.onstop?.(new Event("stop"));
      else this.recorder.stop();
    });
  }

  cancel(): void {
    this.recorder.onstop = null;
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.capture.release();
  }
}

/** A file name for a recording: "Screen recording 2026-10-28 10.30.webm". */
export function recordingName(mode: CaptureMode, mimeType: string, at = new Date()): string {
  const label = mode === "camera" ? "Camera recording" : mode === "screen" ? "Screen recording" : "Voice recording";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
  return `${label} ${stamp}.${ext}`;
}

/** Length and size of a media file, read by loading its metadata. A recording's WebM reports
 *  an infinite length until the end is read, so that case seeks far past it first. */
export function probeMedia(file: Blob, kind: "video" | "audio" | "image"): Promise<{ duration_ms: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  return probeUrl(url, kind).finally(() => URL.revokeObjectURL(url));
}

/** The same, for a file the host already holds (by the URL it plays from). */
export function probeUrl(url: string, kind: "video" | "audio" | "image"): Promise<{ duration_ms: number; width: number; height: number }> {
  return new Promise((resolve) => {
    // A file that never answers (a slow or refused link) counts as unknown after 15 seconds.
    const timer = setTimeout(() => resolve({ duration_ms: 0, width: 0, height: 0 }), 15_000);
    const done = (result: { duration_ms: number; width: number; height: number }) => { clearTimeout(timer); resolve(result); };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ duration_ms: 0, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({ duration_ms: 0, width: 0, height: 0 });
      img.src = url;
      return;
    }
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    const finish = () => done({ duration_ms: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0, width: (el as HTMLVideoElement).videoWidth || 0, height: (el as HTMLVideoElement).videoHeight || 0 });
    el.onloadedmetadata = () => {
      if (el.duration === Infinity) {
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          finish();
        };
        el.currentTime = 1e101;
      } else finish();
    };
    el.onerror = () => done({ duration_ms: 0, width: 0, height: 0 });
    el.src = url;
  });
}
