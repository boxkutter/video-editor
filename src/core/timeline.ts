/**
 * The video editor's timeline (ADR 0068): types matching what the API stores, and the pure
 * operations the editor applies to it (add, move, trim, split, align, effects). Nothing here
 * touches the browser, so it is unit-tested in tests/videoTimeline.test.ts. Every operation
 * returns a new timeline and keeps the rules the API enforces (clips on a track never overlap,
 * a clip is at least MIN_CLIP_MS long), so a saved project is never refused for its shape.
 */
import type { TextAnimation } from "./text";

export const MIN_CLIP_MS = 100;
export const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
export const SNAP_MS = 100;

export type TrackKind = "video" | "audio" | "text";
export type AssetKind = "video" | "audio" | "image";

export interface Asset {
  id: string;
  kind: AssetKind;
  ref: string;
  name: string;
  duration_ms: number;
  width: number;
  height: number;
}

export type EffectType = "brightness" | "contrast" | "saturate" | "grayscale" | "sepia" | "invert" | "blur" | "hue";
export interface Effect {
  type: EffectType;
  amount: number;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextStyle {
  content: string;
  font_size: number;
  align: "left" | "center" | "right";
  weight: "normal" | "bold";
  italic: boolean;
  color: string;
  background: string | null;
  /** A font id from the editor's fonts (`text.fonts`); unknown or missing means the default font. */
  font?: string;
  uppercase?: boolean;
  /** Extra space between letters, in font sizes (-0.1 to 0.5). */
  letter_spacing?: number;
  /** Line spacing, in font sizes (0.8 to 2.5; 1.25 when missing). */
  line_height?: number;
  /** A line around each letter; `width` in font sizes (up to 0.3). */
  outline?: { color: string; width: number } | null;
  /** Missing: a soft shadow without a box, none with one (as before these existed). */
  shadow?: "none" | "soft" | "hard" | "glow";
  shadow_color?: string;
  /** The box behind the text: how opaque (0 to 1) and how round its corners (0 to 1). */
  box_opacity?: number;
  box_radius?: number;
  /** How the title comes in and goes out (with lengths in milliseconds). */
  animation?: { in: TextAnimation; out: TextAnimation; in_ms: number; out_ms: number };
}

export interface Clip {
  id: string;
  start_ms: number;
  duration_ms: number;
  fade_in_ms: number;
  fade_out_ms: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  effects: Effect[];
  asset_id?: string;
  in_ms?: number;
  speed?: number;
  volume?: number;
  crop?: Crop;
  text?: TextStyle;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: Clip[];
}

export interface Timeline {
  assets: Asset[];
  tracks: Track[];
}

export const EFFECTS: Record<EffectType, { label: string; min: number; max: number; step: number; neutral: number; unit: string }> = {
  brightness: { label: "Brightness", min: 0, max: 3, step: 0.05, neutral: 1, unit: "×" },
  contrast: { label: "Contrast", min: 0, max: 3, step: 0.05, neutral: 1, unit: "×" },
  saturate: { label: "Colour strength", min: 0, max: 3, step: 0.05, neutral: 1, unit: "×" },
  grayscale: { label: "Black and white", min: 0, max: 1, step: 0.05, neutral: 0, unit: "" },
  sepia: { label: "Warm tone", min: 0, max: 1, step: 0.05, neutral: 0, unit: "" },
  invert: { label: "Invert", min: 0, max: 1, step: 0.05, neutral: 0, unit: "" },
  blur: { label: "Blur", min: 0, max: 20, step: 0.5, neutral: 0, unit: "px" },
  hue: { label: "Hue shift", min: -180, max: 180, step: 5, neutral: 0, unit: "°" },
};

let counter = 0;
/** A short id that is unique within a project (the API allows letters, digits, - and _). */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyTimeline(): Timeline {
  return { assets: [], tracks: [track("video", "Video 1"), track("audio", "Audio 1"), track("text", "Titles")] };
}

export function track(kind: TrackKind, name: string): Track {
  return { id: newId("t"), kind, name, muted: false, hidden: false, clips: [] };
}

export function clipEnd(clip: Clip): number {
  return clip.start_ms + clip.duration_ms;
}

export function timelineEnd(timeline: Timeline): number {
  let end = 0;
  for (const t of timeline.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function findClip(timeline: Timeline, clipId: string | null): { track: Track; clip: Clip } | null {
  if (!clipId) return null;
  for (const t of timeline.tracks) {
    const clip = t.clips.find((c) => c.id === clipId);
    if (clip) return { track: t, clip };
  }
  return null;
}

export function assetOf(timeline: Timeline, clip: Clip): Asset | undefined {
  return clip.asset_id ? timeline.assets.find((a) => a.id === clip.asset_id) : undefined;
}

const sorted = (clips: Clip[]) => [...clips].sort((a, b) => a.start_ms - b.start_ms);

function mapTrack(timeline: Timeline, trackId: string, fn: (t: Track) => Track): Timeline {
  return { ...timeline, tracks: timeline.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function mapClip(timeline: Timeline, clipId: string, fn: (c: Clip, t: Track) => Clip): Timeline {
  return { ...timeline, tracks: timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c, t) : c)) })) };
}

/** The gap on a track around `start` that a clip of `length` can occupy: [lowest start, highest end]. */
function room(clips: Clip[], ignoreId: string | null, start: number): { from: number; to: number } {
  let from = 0;
  let to = MAX_DURATION_MS;
  for (const c of clips) {
    if (c.id === ignoreId) continue;
    if (clipEnd(c) <= start) from = Math.max(from, clipEnd(c));
    else if (c.start_ms >= start) to = Math.min(to, c.start_ms);
    else return { from: start, to: start }; // `start` is inside another clip
  }
  return { from, to };
}

/** The earliest start at or after `start` where `length` fits on the track, without moving others. */
export function firstFit(t: Track, start: number, length: number, ignoreId: string | null = null): number {
  let at = Math.max(0, start);
  for (const c of sorted(t.clips)) {
    if (c.id === ignoreId) continue;
    if (clipEnd(c) <= at) continue;
    if (c.start_ms >= at + length) break;
    at = clipEnd(c);
  }
  return Math.min(at, MAX_DURATION_MS - length);
}

export function addAsset(timeline: Timeline, asset: Asset): Timeline {
  return { ...timeline, assets: [...timeline.assets, asset] };
}

function baseClip(start: number, duration: number): Clip {
  return { id: newId("c"), start_ms: start, duration_ms: Math.max(MIN_CLIP_MS, Math.round(duration)), fade_in_ms: 0, fade_out_ms: 0, x: 0, y: 0, scale: 1, opacity: 1, effects: [] };
}

/** Where an asset's clip goes by default: its own kind of track, at the playhead or the first free place. */
export function addAssetClip(timeline: Timeline, assetId: string, at: number, trackId?: string): { timeline: Timeline; clipId: string } | null {
  const asset = timeline.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const wanted: TrackKind = asset.kind === "audio" ? "audio" : "video";
  let target = timeline.tracks.find((t) => t.id === trackId && (t.kind === wanted));
  target ??= timeline.tracks.find((t) => t.kind === wanted);
  let working = timeline;
  if (!target) {
    target = track(wanted, wanted === "audio" ? "Audio 1" : "Video 1");
    working = { ...timeline, tracks: [...timeline.tracks, target] };
  }
  const length = asset.kind === "image" ? 5000 : Math.max(MIN_CLIP_MS, asset.duration_ms || 5000);
  const clip: Clip = { ...baseClip(firstFit(target, at, length), length), asset_id: asset.id };
  if (asset.kind !== "image") {
    clip.in_ms = 0;
    clip.speed = 1;
    clip.volume = 1;
  }
  if (asset.kind !== "audio") clip.crop = { x: 0, y: 0, w: 1, h: 1 };
  const placed = mapTrack(working, target.id, (t) => ({ ...t, clips: [...t.clips, clip] }));
  return { timeline: placed, clipId: clip.id };
}

export function addTitle(timeline: Timeline, at: number, content = "Your title"): { timeline: Timeline; clipId: string } {
  let target = timeline.tracks.find((t) => t.kind === "text");
  let working = timeline;
  if (!target) {
    target = track("text", "Titles");
    working = { ...timeline, tracks: [...timeline.tracks, target] };
  }
  const clip: Clip = {
    ...baseClip(firstFit(target, at, 4000), 4000),
    y: 0.7,
    fade_in_ms: 300,
    fade_out_ms: 300,
    text: { content, font_size: 0.07, align: "center", weight: "bold", italic: false, color: "#ffffff", background: null },
  };
  return { timeline: mapTrack(working, target.id, (t) => ({ ...t, clips: [...t.clips, clip] })), clipId: clip.id };
}

export function addTrack(timeline: Timeline, kind: TrackKind): Timeline {
  const count = timeline.tracks.filter((t) => t.kind === kind).length + 1;
  const name = kind === "text" ? `Titles ${count}` : `${kind === "video" ? "Video" : "Audio"} ${count}`;
  return { ...timeline, tracks: [...timeline.tracks, track(kind, name)] };
}

export function removeTrack(timeline: Timeline, trackId: string): Timeline {
  return { ...timeline, tracks: timeline.tracks.filter((t) => t.id !== trackId) };
}

export function updateTrack(timeline: Timeline, trackId: string, patch: Partial<Pick<Track, "name" | "muted" | "hidden">>): Timeline {
  return mapTrack(timeline, trackId, (t) => ({ ...t, ...patch }));
}

export function removeClip(timeline: Timeline, clipId: string): Timeline {
  return { ...timeline, tracks: timeline.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })) };
}

/** Close the gap a removed clip left (ripple delete): later clips on its track move earlier. */
export function rippleRemove(timeline: Timeline, clipId: string): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const { track: t, clip } = found;
  return mapTrack(removeClip(timeline, clipId), t.id, (tr) => ({
    ...tr,
    clips: tr.clips.map((c) => (c.start_ms >= clipEnd(clip) ? { ...c, start_ms: c.start_ms - clip.duration_ms } : c)),
  }));
}

export function duplicateClip(timeline: Timeline, clipId: string): { timeline: Timeline; clipId: string } | null {
  const found = findClip(timeline, clipId);
  if (!found) return null;
  const copy: Clip = { ...structuredCloneClip(found.clip), id: newId("c") };
  copy.start_ms = firstFit(found.track, clipEnd(found.clip), copy.duration_ms);
  return { timeline: mapTrack(timeline, found.track.id, (t) => ({ ...t, clips: [...t.clips, copy] })), clipId: copy.id };
}

function structuredCloneClip(clip: Clip): Clip {
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

/** The free gaps on a track, ignoring one clip: [from, to] pairs, the last one open-ended. */
function gaps(clips: Clip[], ignoreId: string | null): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const c of sorted(clips)) {
    if (c.id === ignoreId) continue;
    if (c.start_ms > at) out.push([at, c.start_ms]);
    at = Math.max(at, clipEnd(c));
  }
  out.push([at, MAX_DURATION_MS]);
  return out;
}

/** Move a clip to a new start (and optionally another track of the same kind). It slides to the
 *  nearest place where it fits, so it never overlaps a neighbour; with no room anywhere it stays. */
export function moveClip(timeline: Timeline, clipId: string, start: number, toTrackId?: string): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const dest = timeline.tracks.find((t) => t.id === (toTrackId ?? found.track.id));
  if (!dest || dest.kind !== found.track.kind) return timeline;
  const length = found.clip.duration_ms;
  const wanted = Math.max(0, Math.round(start));
  let at: number | null = null;
  for (const [from, to] of gaps(dest.clips, clipId)) {
    if (to - from < length) continue;
    const candidate = Math.min(Math.max(wanted, from), to - length);
    if (at === null || Math.abs(candidate - wanted) < Math.abs(at - wanted)) at = candidate;
  }
  if (at === null) return timeline;
  if (dest.id === found.track.id) return mapClip(timeline, clipId, (c) => ({ ...c, start_ms: at }));
  const moved: Clip = { ...found.clip, start_ms: at };
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === found.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t.id === dest.id ? { ...t, clips: [...t.clips, moved] } : t)),
  };
}

/** How long the source of a clip is (for trimming): its asset's length, or unlimited for images and titles. */
function sourceLimit(timeline: Timeline, clip: Clip): number {
  const asset = assetOf(timeline, clip);
  if (!asset || asset.kind === "image" || !asset.duration_ms) return Infinity;
  return asset.duration_ms;
}

/** Trim the start of a clip to `at` on the timeline: the clip gets shorter (or longer, up to its source). */
export function trimStart(timeline: Timeline, clipId: string, at: number): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const { clip, track: t } = found;
  const speed = clip.speed ?? 1;
  const end = clipEnd(clip);
  const { from } = room(t.clips, clipId, clip.start_ms);
  let next = Math.round(Math.min(Math.max(at, from), end - MIN_CLIP_MS));
  if (clip.in_ms !== undefined) {
    const movedSource = (next - clip.start_ms) * speed;
    if (clip.in_ms + movedSource < 0) next = Math.round(clip.start_ms - clip.in_ms / speed);
  }
  return mapClip(timeline, clipId, (c) => ({
    ...c,
    start_ms: next,
    duration_ms: end - next,
    ...(c.in_ms !== undefined ? { in_ms: Math.max(0, Math.round(c.in_ms + (next - c.start_ms) * speed)) } : {}),
  }));
}

/** Trim the end of a clip to `at` on the timeline. */
export function trimEnd(timeline: Timeline, clipId: string, at: number): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const { clip, track: t } = found;
  const speed = clip.speed ?? 1;
  const { to } = room(t.clips, clipId, clip.start_ms);
  let end = Math.max(clip.start_ms + MIN_CLIP_MS, Math.min(Math.round(at), to));
  const limit = sourceLimit(timeline, clip);
  if (clip.in_ms !== undefined && Number.isFinite(limit)) end = Math.min(end, clip.start_ms + (limit - clip.in_ms) / speed);
  end = Math.max(clip.start_ms + MIN_CLIP_MS, Math.round(end));
  return mapClip(timeline, clipId, (c) => ({ ...c, duration_ms: end - c.start_ms }));
}

/** Split the clip under `at` in two. The second half starts where the first ends, in the source too. */
export function splitClip(timeline: Timeline, clipId: string, at: number): { timeline: Timeline; clipId: string } | null {
  const found = findClip(timeline, clipId);
  if (!found) return null;
  const { clip, track: t } = found;
  const cut = Math.round(at);
  if (cut < clip.start_ms + MIN_CLIP_MS || cut > clipEnd(clip) - MIN_CLIP_MS) return null;
  const speed = clip.speed ?? 1;
  const first: Clip = { ...clip, duration_ms: cut - clip.start_ms, fade_out_ms: 0 };
  const second: Clip = {
    ...structuredCloneClip(clip),
    id: newId("c"),
    start_ms: cut,
    duration_ms: clipEnd(clip) - cut,
    fade_in_ms: 0,
    ...(clip.in_ms !== undefined ? { in_ms: Math.round(clip.in_ms + (cut - clip.start_ms) * speed) } : {}),
  };
  return { timeline: mapTrack(timeline, t.id, (tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === clipId ? first : c)).concat(second) })), clipId: second.id };
}

export type Alignment = "playhead" | "previous" | "start";

/** Align a clip: start at the playhead, butt up against the previous clip, or start at zero. */
export function alignClip(timeline: Timeline, clipId: string, how: Alignment, playhead: number): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const { clip, track: t } = found;
  if (how === "playhead") return moveClip(timeline, clipId, playhead);
  if (how === "start") return moveClip(timeline, clipId, 0);
  const before = sorted(t.clips).filter((c) => c.id !== clipId && clipEnd(c) <= clip.start_ms + 1);
  const previous = before[before.length - 1];
  return moveClip(timeline, clipId, previous ? clipEnd(previous) : 0);
}

/** Close every gap on a track so its clips follow one another. */
export function closeGaps(timeline: Timeline, trackId: string): Timeline {
  return mapTrack(timeline, trackId, (t) => {
    let at = 0;
    return { ...t, clips: sorted(t.clips).map((c) => { const moved = { ...c, start_ms: at }; at += c.duration_ms; return moved; }) };
  });
}

export function updateClip(timeline: Timeline, clipId: string, patch: Partial<Clip>): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const next = { ...found.clip, ...patch };
  // fades can never be longer than the clip itself
  next.fade_in_ms = Math.min(next.fade_in_ms, next.duration_ms);
  next.fade_out_ms = Math.min(next.fade_out_ms, next.duration_ms);
  return mapClip(timeline, clipId, () => next);
}

/** Change the speed of a clip, keeping its start and the source it shows; the length follows. */
export function setSpeed(timeline: Timeline, clipId: string, speed: number): Timeline {
  const found = findClip(timeline, clipId);
  if (!found || found.clip.in_ms === undefined) return timeline;
  const { clip } = found;
  const old = clip.speed ?? 1;
  const sourceSpan = clip.duration_ms * old;
  const wanted = Math.max(MIN_CLIP_MS, Math.round(sourceSpan / speed));
  const { to } = room(found.track.clips, clipId, clip.start_ms);
  const duration = Math.max(MIN_CLIP_MS, Math.min(wanted, to - clip.start_ms));
  return updateClip(timeline, clipId, { speed, duration_ms: duration });
}

export function setEffect(timeline: Timeline, clipId: string, effect: Effect): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const rest = found.clip.effects.filter((e) => e.type !== effect.type);
  const spec = EFFECTS[effect.type];
  const neutral = Math.abs(effect.amount - spec.neutral) < 1e-9;
  return updateClip(timeline, clipId, { effects: neutral ? rest : [...rest, effect] });
}

/** The CSS/canvas filter string for a clip's effects ("none" when there are none). */
export function filterString(effects: readonly Effect[]): string {
  if (!effects.length) return "none";
  return effects
    .map((e) => {
      const unit = e.type === "blur" ? "px" : e.type === "hue" ? "deg" : "";
      const name = e.type === "hue" ? "hue-rotate" : e.type;
      return `${name}(${e.amount}${unit})`;
    })
    .join(" ");
}

/** 0 to 1 across the fade in and fade out of a clip at a moment on the timeline. */
export function fadeFactor(clip: Clip, at: number): number {
  const into = at - clip.start_ms;
  const left = clipEnd(clip) - at;
  let f = 1;
  if (clip.fade_in_ms > 0 && into < clip.fade_in_ms) f = Math.min(f, Math.max(0, into) / clip.fade_in_ms);
  if (clip.fade_out_ms > 0 && left < clip.fade_out_ms) f = Math.min(f, Math.max(0, left) / clip.fade_out_ms);
  return f;
}

/** The clips showing or sounding at a moment, bottom track first (so later ones draw on top). */
export function activeClips(timeline: Timeline, at: number): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const t of timeline.tracks) for (const clip of t.clips) if (at >= clip.start_ms && at < clipEnd(clip)) out.push({ track: t, clip });
  return out;
}

/** Where on the source a clip is at a moment on the timeline (ms). */
export function sourceTime(clip: Clip, at: number): number {
  return (clip.in_ms ?? 0) + (at - clip.start_ms) * (clip.speed ?? 1);
}

/** Snap a time to the clip edges and playhead within `threshold`, else to a tenth of a second. */
export function snap(timeline: Timeline, value: number, playhead: number, ignoreId: string | null, threshold: number): number {
  let best = Math.round(value / SNAP_MS) * SNAP_MS;
  let distance = Infinity;
  const points = [0, playhead];
  for (const t of timeline.tracks) for (const c of t.clips) if (c.id !== ignoreId) points.push(c.start_ms, clipEnd(c));
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d <= threshold && d < distance) {
      best = p;
      distance = d;
    }
  }
  return Math.max(0, best);
}

export function formatTime(ms: number, withTenths = true): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const base = `${m}:${String(s).padStart(2, "0")}`;
  return withTenths ? `${base}.${Math.floor((total * 10) % 10)}` : base;
}

/** The clip's length in words for screen readers: "1 minute 4.5 seconds". */
export function spokenDuration(ms: number): string {
  const total = Math.round(ms / 100) / 10;
  const m = Math.floor(total / 60);
  const s = Math.round((total - m * 60) * 10) / 10;
  return [m ? `${m} minute${m === 1 ? "" : "s"}` : "", s || !m ? `${s} second${s === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ");
}

export function classifyFile(type: string): AssetKind | null {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  return null;
}

export const MEDIA_ACCEPT = "video/*,audio/*,image/png,image/jpeg,image/gif,image/webp";
