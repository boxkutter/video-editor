/**
 * The video editor's player and renderer (ADR 0068). It plays a timeline onto a canvas with the
 * sound of its clips, and the same loop, recorded in real time, is the export. Everything runs in
 * the browser: the platform stores the timeline as data and the finished file, nothing else.
 *
 * Media comes from the host through `mediaUrl` (same origin or CORS-enabled, and with Range
 * support so seeking works). One media element per clip, so two clips of the same
 * source can sit on different tracks at different points. Elements are created shortly before a
 * clip starts and released once it is well past.
 */

import { activeClips, assetOf, clipEnd, fadeFactor, filterString, sourceTime, timelineEnd, type Asset, type Clip, type Timeline, type Track } from "./timeline";

export interface Canvasish {
  width: number;
  height: number;
  fps: number;
}

type Playable = HTMLVideoElement | HTMLAudioElement;

const LOOKAHEAD_MS = 2000;
const RELEASE_MS = 6000;
const DRIFT_S = 0.3;

/** Where the media of an asset can be read from: a URL the browser can load (same origin, or CORS-enabled for export). */
export type MediaUrl = (asset: Asset) => string;

export function supportsEditing(): { ok: true } | { ok: false; message: string } {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) {
    return { ok: false, message: "This browser cannot record or export video. Use a current version of Chrome, Edge or Firefox." };
  }
  return { ok: true };
}

export function recorderMimeType(video = true): string | undefined {
  const candidates = video
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c));
}

export class VideoEngine {
  private ctx2d: CanvasRenderingContext2D;
  private elements = new Map<string, Playable>();
  private images = new Map<string, HTMLImageElement>();
  private gains = new Map<string, GainNode>();
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private exportDestination: MediaStreamAudioDestinationNode | null = null;
  private raf = 0;
  private playing = false;
  private startedAt = 0;
  private startedFrom = 0;
  private token = 0;
  now = 0;
  timeline: Timeline = { assets: [], tracks: [] };
  onTime: (ms: number) => void = () => {};
  onEnded: () => void = () => {};

  constructor(
    private mediaUrl: MediaUrl,
    private canvas: HTMLCanvasElement,
    private crossOrigin?: "anonymous" | "use-credentials",
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("A canvas is needed to show the video");
    this.ctx2d = ctx;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    const live = new Set(timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    for (const id of [...this.elements.keys()]) if (!live.has(id)) this.release(id);
    if (!this.playing) void this.renderAt(this.now);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    if (!this.playing) void this.renderAt(this.now);
  }

  // --- media ---------------------------------------------------------------------------------

  private element(clip: Clip): Playable | null {
    const asset = assetOf(this.timeline, clip);
    if (!asset || asset.kind === "image") return null;
    let el = this.elements.get(clip.id);
    if (!el) {
      el = document.createElement(asset.kind === "video" ? "video" : "audio");
      el.preload = "auto";
      if (this.crossOrigin) el.crossOrigin = this.crossOrigin;
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.src = this.mediaUrl(asset);
      el.load();
      this.elements.set(clip.id, el);
      this.connect(clip.id, el);
    }
    return el;
  }

  private image(clip: Clip): HTMLImageElement | null {
    const asset = assetOf(this.timeline, clip);
    if (!asset || asset.kind !== "image") return null;
    let img = this.images.get(asset.id);
    if (!img) {
      img = new Image();
      if (this.crossOrigin) img.crossOrigin = this.crossOrigin;
      img.onload = () => {
        if (!this.playing) void this.renderAt(this.now);
      };
      img.src = this.mediaUrl(asset);
      this.images.set(asset.id, img);
    }
    return img;
  }

  private release(id: string): void {
    const el = this.elements.get(id);
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    el.load();
    this.elements.delete(id);
    // a media element can feed the audio graph only once, so its nodes go with it
    this.gains.get(id)?.disconnect();
    this.gains.delete(id);
  }

  /** Browsers need a user gesture before audio starts; the editor calls this from Play and Record. */
  ensureAudio(): AudioContext {
    if (!this.audio) {
      this.audio = new AudioContext();
      this.master = this.audio.createGain();
      this.master.connect(this.audio.destination);
      this.exportDestination = this.audio.createMediaStreamDestination();
      for (const [id, el] of this.elements) this.connect(id, el);
    }
    if (this.audio.state === "suspended") void this.audio.resume();
    return this.audio;
  }

  private connect(id: string, el: Playable): void {
    if (!this.audio || !this.master || !this.exportDestination || this.gains.has(id)) return;
    try {
      const gain = this.audio.createGain();
      this.audio.createMediaElementSource(el).connect(gain);
      gain.connect(this.master);
      gain.connect(this.exportDestination);
      this.gains.set(id, gain);
    } catch {
      /* already connected: the element keeps its output */
    }
  }

  // --- the clock -----------------------------------------------------------------------------

  async play(from: number, opts: { silent?: boolean } = {}): Promise<void> {
    this.ensureAudio();
    if (this.master) this.master.gain.value = opts.silent ? 0 : 1;
    this.token += 1;
    const end = timelineEnd(this.timeline);
    this.now = from >= end ? 0 : from;
    this.startedFrom = this.now;
    this.startedAt = performance.now();
    this.playing = true;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.playing) return;
      const t = this.startedFrom + (performance.now() - this.startedAt);
      const last = timelineEnd(this.timeline);
      if (t >= last) {
        this.now = last;
        this.stopMedia();
        this.drawFrame(Math.max(0, last - 1));
        this.playing = false;
        this.onTime(last);
        this.onEnded();
        return;
      }
      this.now = t;
      this.syncMedia(t, true);
      this.drawFrame(t);
      this.onTime(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopMedia();
    void this.renderAt(this.now);
  }

  async seek(ms: number): Promise<void> {
    if (this.playing) {
      this.pause();
    }
    this.now = Math.max(0, ms);
    this.onTime(this.now);
    await this.renderAt(this.now);
  }

  private stopMedia(): void {
    for (const el of this.elements.values()) el.pause();
  }

  private syncMedia(t: number, playing: boolean): void {
    for (const [id, el] of this.elements) {
      const found = this.timeline.tracks.flatMap((tr) => tr.clips.map((clip) => ({ clip, track: tr }))).find((x) => x.clip.id === id);
      if (!found) continue;
      const { clip, track } = found;
      if (t > clipEnd(clip) + RELEASE_MS || t < clip.start_ms - RELEASE_MS) {
        this.release(id);
        continue;
      }
      const active = t >= clip.start_ms && t < clipEnd(clip);
      if (!active || !playing) {
        if (!el.paused) el.pause();
        continue;
      }
      const wanted = sourceTime(clip, t) / 1000;
      el.playbackRate = Math.min(4, Math.max(0.25, clip.speed ?? 1));
      if (Math.abs(el.currentTime - wanted) > DRIFT_S) el.currentTime = wanted;
      if (el.paused) void el.play().catch(() => {});
      const gain = this.gains.get(id);
      const level = track.muted ? 0 : (clip.volume ?? 1) * fadeFactor(clip, t);
      if (gain) gain.gain.value = level;
      else el.volume = Math.min(1, level);
    }
  }

  /** Get the media ready for a moment and draw it (used when paused, scrubbing and after edits). */
  async renderAt(ms: number): Promise<void> {
    const mine = ++this.token;
    const waits: Promise<void>[] = [];
    for (const { clip, track } of activeClips(this.timeline, ms)) {
      void track;
      const el = this.element(clip);
      if (el instanceof HTMLVideoElement) {
        const wanted = sourceTime(clip, ms) / 1000;
        if (Math.abs(el.currentTime - wanted) > 0.02 || el.readyState < 2) waits.push(seeked(el, wanted));
      }
    }
    // start loading what comes next so playing from here does not stall
    for (const tr of this.timeline.tracks) for (const clip of tr.clips) if (clip.start_ms > ms && clip.start_ms - ms < LOOKAHEAD_MS) this.element(clip);
    if (waits.length) await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 1500))]);
    if (mine !== this.token || this.playing) return;
    this.drawFrame(ms);
  }

  // --- drawing -------------------------------------------------------------------------------

  drawFrame(ms: number): void {
    const { width: W, height: H } = this.canvas;
    const c = this.ctx2d;
    c.save();
    c.globalAlpha = 1;
    c.filter = "none";
    c.fillStyle = "#000";
    c.fillRect(0, 0, W, H);
    for (const track of this.timeline.tracks) {
      if (track.hidden || track.kind === "audio") continue;
      for (const clip of track.clips) {
        if (ms < clip.start_ms || ms >= clipEnd(clip)) continue;
        c.save();
        c.globalAlpha = Math.max(0, Math.min(1, clip.opacity * fadeFactor(clip, ms)));
        if (track.kind === "text" && clip.text) drawText(c, clip, W, H);
        else this.drawPicture(c, track, clip, W, H);
        c.restore();
      }
    }
    c.restore();
  }

  private drawPicture(c: CanvasRenderingContext2D, _track: Track, clip: Clip, W: number, H: number): void {
    const el = this.elements.get(clip.id);
    const source: CanvasImageSource | null = this.image(clip) ?? (el instanceof HTMLVideoElement ? el : null);
    let sw = 0;
    let sh = 0;
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2) return;
      sw = source.videoWidth;
      sh = source.videoHeight;
    } else if (source instanceof HTMLImageElement) {
      if (!source.complete || !source.naturalWidth) return;
      sw = source.naturalWidth;
      sh = source.naturalHeight;
    }
    if (!source || !sw || !sh) return;
    const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const cx = crop.x * sw;
    const cy = crop.y * sh;
    const cw = crop.w * sw;
    const ch = crop.h * sh;
    const fit = Math.min(W / cw, H / ch) * clip.scale;
    const dw = cw * fit;
    const dh = ch * fit;
    c.filter = filterString(clip.effects);
    c.drawImage(source, cx, cy, cw, ch, W / 2 + (clip.x * W) / 2 - dw / 2, H / 2 + (clip.y * H) / 2 - dh / 2, dw, dh);
  }

  // --- export --------------------------------------------------------------------------------

  /** Records the whole timeline, in real time, to one file. The picture is the canvas; the sound is every clip's. */
  async exportVideo(fps: number, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; durationMs: number; mimeType: string }> {
    const mimeType = recorderMimeType(true);
    if (!mimeType) throw new Error("This browser cannot record video.");
    const durationMs = timelineEnd(this.timeline);
    if (durationMs <= 0) throw new Error("Add something to the timeline first.");
    this.ensureAudio();
    const stream = this.canvas.captureStream(fps);
    this.exportDestination?.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.min(12_000_000, Math.round(this.canvas.width * this.canvas.height * fps * 0.12)) });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    await this.seek(0);
    recorder.start(1000);
    const finished = new Promise<void>((resolve) => {
      this.onEnded = resolve;
      signal?.addEventListener("abort", () => resolve());
    });
    const progress = this.onTime;
    this.onTime = (ms) => {
      onProgress(Math.min(1, ms / durationMs));
      progress(ms);
    };
    await this.play(0, { silent: true });
    await finished;
    this.onTime = progress;
    this.onEnded = () => {};
    this.pause();
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (signal?.aborted) throw new Error("Export cancelled.");
    if (this.master) this.master.gain.value = 1;
    return { blob: new Blob(chunks, { type: mimeType.split(";")[0] }), durationMs, mimeType };
  }

  dispose(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const id of [...this.elements.keys()]) this.release(id);
    void this.audio?.close();
  }
}

function seeked(el: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener("seeked", done);
      el.removeEventListener("loadeddata", done);
      resolve();
    };
    el.addEventListener("seeked", done);
    el.addEventListener("loadeddata", done);
    if (el.readyState >= 1) el.currentTime = seconds;
    else el.addEventListener("loadedmetadata", () => (el.currentTime = seconds), { once: true });
  });
}

function drawText(c: CanvasRenderingContext2D, clip: Clip, W: number, H: number): void {
  const text = clip.text;
  if (!text) return;
  const size = Math.max(8, text.font_size * H * clip.scale);
  c.font = `${text.italic ? "italic " : ""}${text.weight === "bold" ? "bold " : ""}${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
  c.textBaseline = "middle";
  const maxWidth = W * 0.9;
  const lines = wrap(c, text.content, maxWidth);
  const lineHeight = size * 1.25;
  const blockHeight = lines.length * lineHeight;
  const widest = Math.max(...lines.map((l) => c.measureText(l).width));
  const centreX = W / 2 + (clip.x * W) / 2;
  const centreY = H / 2 + (clip.y * H) / 2;
  const left = text.align === "left" ? centreX - widest / 2 : text.align === "right" ? centreX + widest / 2 : centreX;
  c.textAlign = text.align;
  if (text.background) {
    const pad = size * 0.4;
    c.fillStyle = text.background;
    c.fillRect(centreX - widest / 2 - pad, centreY - blockHeight / 2 - pad / 2, widest + pad * 2, blockHeight + pad);
  }
  c.fillStyle = text.color;
  if (!text.background) {
    c.shadowColor = "rgba(0,0,0,0.6)";
    c.shadowBlur = size * 0.15;
  }
  lines.forEach((line, i) => c.fillText(line, left, centreY - blockHeight / 2 + lineHeight * (i + 0.5)));
}

function wrap(c: CanvasRenderingContext2D, content: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of content.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const attempt = line ? `${line} ${word}` : word;
      if (line && c.measureText(attempt).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = attempt;
    }
    out.push(line);
  }
  return out;
}
