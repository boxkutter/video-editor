/**
 * Putting media on the timeline the two ways an editor offers: insert (open a gap where it goes,
 * splitting a clip it lands in and moving what follows along) or replace (swap the clip there for
 * the new media, keeping its place, length and settings). Both keep the rule that clips on a track
 * never overlap.
 */
import { MAX_DURATION_MS, MIN_CLIP_MS, addAssetClip, clipEnd, findClip, splitClip, type Clip, type Timeline, type TrackKind } from "./timeline";

export type AddMode = "insert" | "replace";

const trackKindFor = (kind: "video" | "audio" | "image"): TrackKind => (kind === "audio" ? "audio" : "video");

function targetTrack(timeline: Timeline, assetId: string, trackId?: string) {
  const asset = timeline.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const wanted = trackKindFor(asset.kind);
  const track = timeline.tracks.find((t) => t.id === trackId && t.kind === wanted) ?? timeline.tracks.find((t) => t.kind === wanted) ?? null;
  return { asset, track };
}

/** Insert an asset at `at`: a clip it lands inside is split there, and everything after moves along by its length. */
export function insertClip(timeline: Timeline, assetId: string, at: number, trackId?: string): { timeline: Timeline; clipId: string } | null {
  const found = targetTrack(timeline, assetId, trackId);
  if (!found) return null;
  if (!found.track) return addAssetClip(timeline, assetId, at, trackId); // makes the track
  let working = timeline;
  let point = Math.max(0, Math.round(at));
  const inside = found.track.clips.find((c) => c.start_ms < point && clipEnd(c) > point);
  if (inside) {
    const split = splitClip(working, inside.id, point);
    if (split) working = split.timeline;
    // Too near an end to split: insert at that end instead.
    else point = point - inside.start_ms < clipEnd(inside) - point ? inside.start_ms : clipEnd(inside);
  }
  const asset = found.asset;
  const length = asset.kind === "image" ? 5000 : Math.max(MIN_CLIP_MS, asset.duration_ms || 5000);
  const trackIdNow = found.track.id;
  const shifted: Timeline = {
    ...working,
    tracks: working.tracks.map((t) => (t.id !== trackIdNow ? t : { ...t, clips: t.clips.map((c) => (c.start_ms >= point ? { ...c, start_ms: Math.min(c.start_ms + length, MAX_DURATION_MS - c.duration_ms) } : c)) })),
  };
  return addAssetClip(shifted, assetId, point, trackIdNow);
}

/** Replace a clip's media with an asset of a kind its track can hold, keeping the clip's place, length (at most the new media's) and settings. */
export function replaceClip(timeline: Timeline, assetId: string, clipId: string): { timeline: Timeline; clipId: string } | null {
  const asset = timeline.assets.find((a) => a.id === assetId);
  const found = findClip(timeline, clipId);
  if (!asset || !found || found.track.kind !== trackKindFor(asset.kind) || found.clip.text) return null;
  const old = found.clip;
  const length = asset.kind === "image" || !asset.duration_ms ? old.duration_ms : Math.max(MIN_CLIP_MS, Math.min(old.duration_ms, asset.duration_ms));
  const next: Clip = {
    ...old,
    asset_id: asset.id,
    duration_ms: length,
    fade_in_ms: Math.min(old.fade_in_ms, length),
    fade_out_ms: Math.min(old.fade_out_ms, length),
  };
  if (asset.kind === "image") { delete next.in_ms; delete next.speed; delete next.volume; }
  else { next.in_ms = 0; next.speed = 1; next.volume = old.volume ?? 1; }
  if (asset.kind !== "audio") next.crop = { x: 0, y: 0, w: 1, h: 1 };
  else delete next.crop;
  return { timeline: { ...timeline, tracks: timeline.tracks.map((t) => (t.id !== found.track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clipId ? next : c)) })) }, clipId };
}

/** Put an asset on the timeline at `at` the chosen way. Replace with no clip there just places it. */
export function placeClip(timeline: Timeline, assetId: string, at: number, mode: AddMode, opts: { trackId?: string; clipId?: string | null } = {}): { timeline: Timeline; clipId: string } | null {
  if (mode === "insert") return insertClip(timeline, assetId, at, opts.trackId);
  const found = targetTrack(timeline, assetId, opts.trackId);
  const under = opts.clipId ?? found?.track?.clips.find((c) => c.start_ms <= at && clipEnd(c) > at)?.id ?? null;
  return (under && replaceClip(timeline, assetId, under)) || addAssetClip(timeline, assetId, at, opts.trackId);
}
