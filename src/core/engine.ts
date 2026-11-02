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

import { DEFAULT_FONT_FAMILY, revealLines, textFrame, type FontChoice } from "./text";
import { activeClips, assetOf, clipEnd, fadeFactor, filterString, sourceTime, timelineEnd, type Asset, type Clip, type Timeline, type TextStyle, type Track } from "./timeline";

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
  private fonts = new Map<string, FontChoice>();
  private fontsAsked = new Set<string>();
  /** Where each clip was last drawn (canvas pixels), for picking one on the preview. Drawing order. */
  private drawn: { clipId: string; x: number; y: number; w: number; h: number }[] = [];
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

  /** The fonts titles may name (`text.font`). */
  setFonts(fonts: readonly FontChoice[]): void {
    this.fonts = new Map(fonts.map((f) => [f.id, f]));
    if (!this.playing) void this.renderAt(this.now);
  }

  private familyOf(text: TextStyle): string {
    return this.fonts.get(text.font ?? "")?.family ?? DEFAULT_FONT_FAMILY;
  }

  private fontKey(text: TextStyle): string {
    return `${text.italic ? "italic " : ""}${text.weight === "bold" ? "700" : "400"} 48px ${this.familyOf(text)}`;
  }

  /** Ask the browser for a title's font; draw again once it has arrived (a web font is fetched on first use). */
  private askFont(text: TextStyle): void {
    if (typeof document === "undefined" || !document.fonts) return;
    const key = this.fontKey(text);
    if (this.fontsAsked.has(key)) return;
    this.fontsAsked.add(key);
    void document.fonts.load(key).then(() => { if (!this.playing) this.drawFrame(this.now); }, () => {});
  }

  /** Every font the timeline's titles use, loaded (before an export, so no frame uses a stand-in). */
  async fontsReady(): Promise<void> {
    if (typeof document === "undefined" || !document.fonts) return;
    const keys = new Set(this.timeline.tracks.flatMap((t) => t.clips.flatMap((c) => (c.text ? [this.fontKey(c.text)] : []))));
    await Promise.race([Promise.all([...keys].map((k) => document.fonts.load(k).catch(() => []))), new Promise((r) => setTimeout(r, 5000))]);
  }

  /** The clip drawn on top at a point of the picture (canvas pixels), if any. */
  clipAt(x: number, y: number): string | null {
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const d = this.drawn[i]!;
      if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return d.clipId;
    }
    return null;
  }

  /** Where a clip was last drawn (canvas pixels). */
  boundsOf(clipId: string): { x: number; y: number; w: number; h: number } | null {
    return this.drawn.find((d) => d.clipId === clipId) ?? null;
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
    this.drawn = [];
    for (const track of this.timeline.tracks) {
      if (track.hidden || track.kind === "audio") continue;
      for (const clip of track.clips) {
        if (ms < clip.start_ms || ms >= clipEnd(clip)) continue;
        c.save();
        c.globalAlpha = Math.max(0, Math.min(1, clip.opacity * fadeFactor(clip, ms)));
        if (track.kind === "text" && clip.text) {
          this.askFont(clip.text);
          const box = drawText(c, clip, W, H, this.familyOf(clip.text), ms);
          if (box) this.drawn.push({ clipId: clip.id, ...box });
        } else this.drawPicture(c, track, clip, W, H);
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
    const dx = W / 2 + (clip.x * W) / 2 - dw / 2;
    const dy = H / 2 + (clip.y * H) / 2 - dh / 2;
    c.drawImage(source, cx, cy, cw, ch, dx, dy, dw, dh);
    this.drawn.push({ clipId: clip.id, x: dx, y: dy, w: dw, h: dh });
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
    await this.fontsReady();
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

/**
 * Draw a title: its font, colour, outline, shadow or glow, the box behind it, and where it is in its
 * entry or exit animation. Returns the box it covers (canvas pixels, before animation), for picking.
 */
function drawText(c: CanvasRenderingContext2D, clip: Clip, W: number, H: number, family: string, ms: number): { x: number; y: number; w: number; h: number } | null {
  const text = clip.text;
  if (!text) return null;
  const f = textFrame(clip, ms);
  const size = Math.max(8, text.font_size * H * clip.scale);
  c.font = `${text.italic ? "italic " : ""}${text.weight === "bold" ? "bold " : ""}${size}px ${family}`;
  const spacing = (text.letter_spacing ?? 0) * size;
  if ("letterSpacing" in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  c.textBaseline = "middle";
  c.textAlign = "left";
  const content = text.uppercase ? text.content.toLocaleUpperCase() : text.content;
  const lines = wrap(c, content, W * 0.9);
  const widths = lines.map((l) => c.measureText(l).width);
  const lineHeight = size * (text.line_height ?? 1.25);
  const blockHeight = lines.length * lineHeight;
  const widest = Math.max(1, ...widths);
  const pad = size * 0.4;
  // A title stays inside the picture (a lower third placed for a wide picture still fits a tall one).
  const margin = W * 0.03;
  const halfBox = widest / 2 + pad;
  let centreX = W / 2 + (clip.x * W) / 2;
  if (halfBox * 2 <= W - margin * 2) centreX = Math.min(Math.max(centreX, margin + halfBox), W - margin - halfBox);
  const centreY = H / 2 + (clip.y * H) / 2;
  const box = { x: centreX - widest / 2 - pad, y: centreY - blockHeight / 2 - pad / 2, w: widest + pad * 2, h: blockHeight + pad };
  if (f.alpha <= 0 || f.wipe <= 0) return box;

  c.save();
  c.globalAlpha *= f.alpha;
  c.translate(centreX + f.dx * size, centreY + f.dy * size);
  if (f.scale !== 1) c.scale(f.scale, f.scale);
  if (f.blur > 0) c.filter = `blur(${f.blur * size}px)`;
  const left = -widest / 2 - pad;
  const top = -blockHeight / 2 - pad / 2;
  if (f.wipe < 1) {
    c.beginPath();
    c.rect(left - size, top - size, (box.w + size * 2) * f.wipe, box.h + size * 2);
    c.clip();
  }
  if (text.background) {
    c.save();
    c.globalAlpha *= text.box_opacity ?? 1;
    c.fillStyle = text.background;
    const radius = Math.min(box.h / 2, (text.box_radius ?? 0) * pad * 2.5);
    c.beginPath();
    if (radius > 0 && typeof c.roundRect === "function") c.roundRect(left, top, box.w, box.h, radius);
    else c.rect(left, top, box.w, box.h);
    c.fill();
    c.restore();
  }
  const shadow = text.shadow ?? (text.background ? "none" : "soft");
  const setShadow = () => {
    if (shadow === "soft") { c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = size * 0.15; }
    else if (shadow === "hard") { c.shadowColor = text.shadow_color ?? "#000000"; c.shadowBlur = 0; c.shadowOffsetX = size * 0.06; c.shadowOffsetY = size * 0.06; }
    else if (shadow === "glow") { c.shadowColor = text.shadow_color ?? text.color; c.shadowBlur = size * 0.45; }
  };
  const noShadow = () => { c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0; };
  const shown = revealLines(lines, f.reveal, f.revealBy);
  const xOf = (i: number) => (text.align === "left" ? -widest / 2 : text.align === "right" ? widest / 2 - widths[i]! : -widths[i]! / 2);
  const yOf = (i: number) => -blockHeight / 2 + lineHeight * (i + 0.5);
  const outline = text.outline && text.outline.width > 0 ? text.outline : null;
  if (outline) {
    c.lineJoin = "round";
    c.strokeStyle = outline.color;
    c.lineWidth = outline.width * size * 2;
    setShadow();
    shown.forEach((line, i) => line && c.strokeText(line, xOf(i), yOf(i)));
    noShadow();
  } else setShadow();
  c.fillStyle = text.color;
  shown.forEach((line, i) => line && c.fillText(line, xOf(i), yOf(i)));
  // A glow is drawn twice, for a stronger halo.
  if (shadow === "glow" && !outline) shown.forEach((line, i) => line && c.fillText(line, xOf(i), yOf(i)));
  c.restore();
  return box;
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
