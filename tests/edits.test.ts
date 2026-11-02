import { describe, expect, it } from "vitest";
import { insertClip, placeClip, replaceClip } from "../src/core/edits";
import { addAsset, addAssetClip, clipEnd, emptyTimeline, findClip, type Timeline } from "../src/core/timeline";

function setup(): { tl: Timeline; a: string; b: string } {
  let tl = emptyTimeline();
  tl = addAsset(tl, { id: "v1", kind: "video", ref: "r1", name: "one", duration_ms: 4000, width: 0, height: 0 });
  tl = addAsset(tl, { id: "v2", kind: "video", ref: "r2", name: "two", duration_ms: 3000, width: 0, height: 0 });
  tl = addAsset(tl, { id: "img", kind: "image", ref: "r3", name: "pic", duration_ms: 0, width: 0, height: 0 });
  tl = addAsset(tl, { id: "snd", kind: "audio", ref: "r4", name: "sound", duration_ms: 9000, width: 0, height: 0 });
  const first = addAssetClip(tl, "v1", 0)!;
  const second = addAssetClip(first.timeline, "v1", 4000)!;
  return { tl: second.timeline, a: first.clipId, b: second.clipId };
}
const video = (tl: Timeline) => tl.tracks.find((t) => t.kind === "video")!.clips.map((c) => [c.asset_id, c.start_ms, clipEnd(c)]).sort((x, y) => (x[1] as number) - (y[1] as number));

describe("insert", () => {
  it("at a join opens a gap and moves the rest along", () => {
    const { tl } = setup();
    expect(video(insertClip(tl, "v2", 4000)!.timeline)).toEqual([["v1", 0, 4000], ["v2", 4000, 7000], ["v1", 7000, 11000]]);
  });
  it("inside a clip splits it", () => {
    const { tl } = setup();
    expect(video(insertClip(tl, "v2", 1000)!.timeline)).toEqual([["v1", 0, 1000], ["v2", 1000, 4000], ["v1", 4000, 7000], ["v1", 7000, 11000]]);
  });
});

describe("replace", () => {
  it("keeps the clip's place and settings, and its length when the new media is longer or a picture", () => {
    const { tl, b } = setup();
    const r = replaceClip(tl, "img", b)!;
    const c = findClip(r.timeline, b)!.clip;
    expect([c.asset_id, c.start_ms, c.duration_ms, c.in_ms]).toEqual(["img", 4000, 4000, undefined]);
    expect(findClip(replaceClip(tl, "v2", b)!.timeline, b)!.clip.duration_ms).toBe(3000);
  });
  it("refuses media its track cannot hold", () => {
    const { tl, a } = setup();
    expect(replaceClip(tl, "snd", a)).toBeNull();
  });
  it("with nothing under the point just places the media", () => {
    const { tl } = setup();
    expect(video(placeClip(tl, "v2", 9000, "replace")!.timeline).at(-1)).toEqual(["v2", 9000, 12000]);
    expect(video(placeClip(tl, "v2", 500, "replace")!.timeline)[0]).toEqual(["v2", 0, 3000]);
  });
});
