import { describe, expect, it } from "vitest";
import { cropToRatio, initialState, reduce, sizeId } from "../src/core/state";
import { addTitle, emptyTimeline, moveClip } from "../src/core/timeline";

describe("editor state", () => {
  it("undoes and redoes edits, and a new edit clears redo", () => {
    let s = initialState(emptyTimeline());
    const titled = addTitle(s.timeline, 0);
    s = reduce(s, { type: "edit", timeline: titled.timeline, select: titled.clipId });
    expect(s.selected).toBe(titled.clipId);
    s = reduce(s, { type: "undo" });
    expect(s.timeline.tracks.every((t) => t.clips.length === 0)).toBe(true);
    expect(s.selected).toBeNull(); // the clip is gone, so is the selection
    s = reduce(s, { type: "redo" });
    expect(s.timeline).toBe(titled.timeline);
    s = reduce(s, { type: "undo" });
    s = reduce(s, { type: "edit", timeline: addTitle(s.timeline, 0, "Other").timeline });
    expect(s.future).toHaveLength(0);
  });

  it("makes one undo step of a whole drag", () => {
    const base = addTitle(emptyTimeline(), 0);
    let s = reduce(initialState(emptyTimeline()), { type: "edit", timeline: base.timeline });
    const before = s.timeline;
    for (const at of [100, 500, 900]) s = reduce(s, { type: "live", timeline: moveClip(s.timeline, base.clipId, at) });
    s = reduce(s, { type: "commit", before });
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: "undo" });
    expect(s.timeline).toBe(before);
  });

  it("does nothing when there is nothing to undo or redo", () => {
    const s = initialState(emptyTimeline());
    expect(reduce(s, { type: "undo" })).toBe(s);
    expect(reduce(s, { type: "redo" })).toBe(s);
    expect(reduce(s, { type: "edit", timeline: s.timeline })).toBe(s);
  });
});

describe("sizes and crops", () => {
  it("names a size or says custom", () => {
    expect(sizeId(1920, 1080)).toBe("fhd");
    expect(sizeId(700, 500)).toBe("custom");
  });

  it("crops a source to a shape from its centre", () => {
    expect(cropToRatio(1920, 1080, 1)).toEqual({ x: 0.21875, y: 0, w: 0.5625, h: 1 });
    expect(cropToRatio(1000, 1000, 16 / 9).h).toBeCloseTo(0.5625);
    expect(cropToRatio(1280, 720, 16 / 9)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(cropToRatio(0, 0, 1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
