import { describe, expect, it } from "vitest";
import {
  addAsset,
  addAssetClip,
  addTitle,
  alignClip,
  closeGaps,
  clipEnd,
  duplicateClip,
  emptyTimeline,
  fadeFactor,
  filterString,
  findClip,
  formatTime,
  moveClip,
  rippleRemove,
  setEffect,
  setSpeed,
  snap,
  sourceTime,
  spokenDuration,
  splitClip,
  timelineEnd,
  trimEnd,
  trimStart,
  type Timeline,
} from "../src/core/timeline";

function withVideo(length = 10_000): { timeline: Timeline; clipId: string } {
  let timeline = addAsset(emptyTimeline(), { id: "a1", kind: "video", ref: "f", name: "x", duration_ms: length, width: 1280, height: 720 });
  const added = addAssetClip(timeline, "a1", 0)!;
  timeline = added.timeline;
  return { timeline, clipId: added.clipId };
}

describe("adding", () => {
  it("puts a video on the video track at the first free place, whole length", () => {
    const { timeline, clipId } = withVideo();
    const found = findClip(timeline, clipId)!;
    expect(found.track.kind).toBe("video");
    expect(found.clip).toMatchObject({ start_ms: 0, duration_ms: 10_000, in_ms: 0, speed: 1, volume: 1 });
    const second = addAssetClip(timeline, "a1", 0)!;
    expect(findClip(second.timeline, second.clipId)!.clip.start_ms).toBe(10_000);
  });

  it("puts audio on an audio track and a title on the titles track", () => {
    let t = addAsset(emptyTimeline(), { id: "m", kind: "audio", ref: "f", name: "m", duration_ms: 3000, width: 0, height: 0 });
    const a = addAssetClip(t, "m", 500)!;
    expect(findClip(a.timeline, a.clipId)!.track.kind).toBe("audio");
    t = a.timeline;
    const title = addTitle(t, 1000);
    const found = findClip(title.timeline, title.clipId)!;
    expect(found.track.kind).toBe("text");
    expect(found.clip.text?.content).toBe("Your title");
  });

  it("makes a track when none of the kind exists", () => {
    const t = addAsset({ assets: [], tracks: [] }, { id: "i", kind: "image", ref: "f", name: "i", duration_ms: 0, width: 10, height: 10 });
    const a = addAssetClip(t, "i", 0)!;
    expect(a.timeline.tracks).toHaveLength(1);
    expect(findClip(a.timeline, a.clipId)!.clip.duration_ms).toBe(5000);
  });
});

describe("trimming and splitting", () => {
  it("trims the start and moves the source in point with it", () => {
    const { timeline, clipId } = withVideo();
    const clip = findClip(trimStart(timeline, clipId, 2000), clipId)!.clip;
    expect(clip).toMatchObject({ start_ms: 2000, duration_ms: 8000, in_ms: 2000 });
  });

  it("cannot trim before the start of the source, or to nothing", () => {
    const first = withVideo();
    let timeline = first.timeline;
    const clipId = first.clipId;
    timeline = trimStart(timeline, clipId, 4000);
    timeline = trimStart(timeline, clipId, 0); // wants to grow back to the left of the source start
    expect(findClip(timeline, clipId)!.clip.in_ms).toBe(0);
    const tiny = findClip(trimEnd(timeline, clipId, 0), clipId)!.clip;
    expect(tiny.duration_ms).toBe(100);
  });

  it("cannot trim the end past the source", () => {
    const first = withVideo();
    let timeline = first.timeline;
    const clipId = first.clipId;
    timeline = trimEnd(timeline, clipId, 5000);
    expect(findClip(timeline, clipId)!.clip.duration_ms).toBe(5000);
    timeline = trimEnd(timeline, clipId, 99_000);
    expect(findClip(timeline, clipId)!.clip.duration_ms).toBe(10_000);
  });

  it("splits into two clips that together show the same source", () => {
    const { timeline, clipId } = withVideo();
    const cut = splitClip(timeline, clipId, 4000)!;
    const first = findClip(cut.timeline, clipId)!.clip;
    const second = findClip(cut.timeline, cut.clipId)!.clip;
    expect(first.duration_ms).toBe(4000);
    expect(second).toMatchObject({ start_ms: 4000, duration_ms: 6000, in_ms: 4000 });
    expect(clipEnd(second)).toBe(timelineEnd(timeline));
  });

  it("does not split at the very edge", () => {
    const { timeline, clipId } = withVideo();
    expect(splitClip(timeline, clipId, 20)).toBeNull();
    expect(splitClip(timeline, clipId, 10_000)).toBeNull();
  });
});

describe("moving and aligning", () => {
  it("keeps clips on a track from overlapping", () => {
    const { timeline, clipId } = withVideo(2000);
    const b = addAssetClip(timeline, "a1", 0)!; // second clip at 2000..4000
    expect(findClip(moveClip(b.timeline, b.clipId, 1000), b.clipId)!.clip.start_ms).toBe(2000);
    expect(findClip(moveClip(b.timeline, clipId, 1000), clipId)!.clip.start_ms).toBe(0); // no room: stays
    expect(findClip(moveClip(b.timeline, b.clipId, 5000), b.clipId)!.clip.start_ms).toBe(5000);
  });

  it("refuses to move onto a track of another kind", () => {
    const { timeline, clipId } = withVideo();
    const audio = timeline.tracks.find((t) => t.kind === "audio")!;
    expect(moveClip(timeline, clipId, 0, audio.id)).toBe(timeline);
  });

  it("aligns to the playhead, the previous clip, or the start", () => {
    const { timeline } = withVideo(2000);
    const b = addAssetClip(timeline, "a1", 5000)!;
    const toPrev = alignClip(b.timeline, b.clipId, "previous", 0);
    expect(findClip(toPrev, b.clipId)!.clip.start_ms).toBe(2000);
    expect(findClip(alignClip(b.timeline, b.clipId, "playhead", 7500), b.clipId)!.clip.start_ms).toBe(7500);
    expect(findClip(alignClip(b.timeline, b.clipId, "start", 0), b.clipId)!.clip.start_ms).toBeGreaterThanOrEqual(2000);
  });

  it("closes gaps and ripple-deletes", () => {
    const { timeline, clipId } = withVideo(2000);
    const b = addAssetClip(timeline, "a1", 5000)!;
    const trackId = findClip(b.timeline, clipId)!.track.id;
    expect(findClip(closeGaps(b.timeline, trackId), b.clipId)!.clip.start_ms).toBe(2000);
    const rippled = rippleRemove(b.timeline, clipId);
    expect(findClip(rippled, clipId)).toBeNull();
    expect(findClip(rippled, b.clipId)!.clip.start_ms).toBe(3000);
  });

  it("duplicates after the original", () => {
    const { timeline, clipId } = withVideo(2000);
    const copy = duplicateClip(timeline, clipId)!;
    expect(findClip(copy.timeline, copy.clipId)!.clip.start_ms).toBe(2000);
  });
});

describe("speed, effects and fades", () => {
  it("changes the length with the speed, keeping what the clip shows", () => {
    const { timeline, clipId } = withVideo(8000);
    const fast = findClip(setSpeed(timeline, clipId, 2), clipId)!.clip;
    expect(fast).toMatchObject({ speed: 2, duration_ms: 4000 });
    expect(sourceTime(fast, 1000)).toBe(2000);
  });

  it("writes effects as a filter and drops neutral ones", () => {
    const { timeline, clipId } = withVideo();
    let t = setEffect(timeline, clipId, { type: "grayscale", amount: 1 });
    t = setEffect(t, clipId, { type: "blur", amount: 4 });
    t = setEffect(t, clipId, { type: "hue", amount: 90 });
    expect(filterString(findClip(t, clipId)!.clip.effects)).toBe("grayscale(1) blur(4px) hue-rotate(90deg)");
    t = setEffect(t, clipId, { type: "grayscale", amount: 0 });
    expect(findClip(t, clipId)!.clip.effects.map((e) => e.type)).toEqual(["blur", "hue"]);
    expect(filterString([])).toBe("none");
  });

  it("fades in and out", () => {
    const c = { id: "c", start_ms: 1000, duration_ms: 4000, fade_in_ms: 1000, fade_out_ms: 500, x: 0, y: 0, scale: 1, opacity: 1, effects: [] };
    expect(fadeFactor(c, 1000)).toBe(0);
    expect(fadeFactor(c, 1500)).toBeCloseTo(0.5);
    expect(fadeFactor(c, 3000)).toBe(1);
    expect(fadeFactor(c, 4750)).toBeCloseTo(0.5);
  });
});

describe("helpers", () => {
  it("snaps to edges and the playhead, else to a tenth of a second", () => {
    const { timeline, clipId } = withVideo(2000);
    expect(snap(timeline, 2040, 0, clipId, 150)).toBe(2000);
    expect(snap(timeline, 4960, 5000, null, 100)).toBe(5000);
    expect(snap(timeline, 3333, 0, null, 10)).toBe(3300);
  });

  it("formats time for the eye and for a screen reader", () => {
    expect(formatTime(65_400)).toBe("1:05.4");
    expect(formatTime(65_400, false)).toBe("1:05");
    expect(spokenDuration(64_500)).toBe("1 minute 4.5 seconds");
    expect(spokenDuration(2000)).toBe("2 seconds");
  });
});
