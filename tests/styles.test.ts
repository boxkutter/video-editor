import { describe, expect, it } from "vitest";
import { addAsset, addAssetClip, addTitle, emptyTimeline, findClip, type Timeline } from "../src/core/timeline";
import { applyLook, applyTransition, takesLook } from "../src/core/styles";

function twoClips(): { tl: Timeline; a: string; b: string } {
  let tl = addAsset(emptyTimeline(), { id: "v", kind: "video", ref: "r", name: "v", duration_ms: 4000, width: 0, height: 0 });
  const first = addAssetClip(tl, "v", 0)!;
  const second = addAssetClip(first.timeline, "v", 4000)!;
  return { tl: second.timeline, a: first.clipId, b: second.clipId };
}
const clip = (tl: Timeline, id: string) => findClip(tl, id)!.clip;

describe("looks", () => {
  it("replace a picture clip's effects, keeping to those offered", () => {
    const { tl, a } = twoClips();
    const vivid = applyLook(tl, a, "vivid");
    expect(clip(vivid, a).effects.map((e) => e.type).sort()).toEqual(["contrast", "saturate"]);
    expect(clip(applyLook(vivid, a, "none"), a).effects).toEqual([]);
    expect(clip(applyLook(tl, a, "vivid", ["saturate"]), a).effects).toEqual([{ type: "saturate", amount: 1.6 }]);
  });

  it("leave titles and sound alone", () => {
    const t = addTitle(emptyTimeline(), 0, "Hi");
    expect(takesLook(t.timeline, t.clipId)).toBe(false);
    expect(applyLook(t.timeline, t.clipId, "warm")).toBe(t.timeline);
  });
});

describe("transitions", () => {
  it("fade a clip in, out or both, never longer than half the clip", () => {
    const { tl, a } = twoClips();
    expect(clip(applyTransition(tl, a, "fade_in"), a).fade_in_ms).toBe(1000);
    const both = clip(applyTransition(tl, a, "fade_both"), a);
    expect([both.fade_in_ms, both.fade_out_ms]).toEqual([1000, 1000]);
  });

  it("dip through black at the cut nearest the drop", () => {
    const { tl, a, b } = twoClips();
    const atEnd = applyTransition(tl, a, "dip", 3800);
    expect(clip(atEnd, a).fade_out_ms).toBe(1000);
    expect(clip(atEnd, b).fade_in_ms).toBe(1000);
    const atStart = applyTransition(tl, b, "dip", 4100);
    expect(clip(atStart, a).fade_out_ms).toBe(1000);
    expect(clip(atStart, b).fade_in_ms).toBe(1000);
    // the first clip's start has no neighbour: only it fades
    const lone = applyTransition(tl, a, "dip", 100);
    expect(clip(lone, a).fade_in_ms).toBe(1000);
    expect(clip(lone, b).fade_in_ms).toBe(0);
  });
});
