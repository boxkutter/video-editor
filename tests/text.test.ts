import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_PRESETS, addStyledTitle, applyTextPreset, revealLines, textFrame } from "../src/core/text";
import { emptyTimeline, findClip, type Clip } from "../src/core/timeline";
import { resolveConfig } from "../src/core/config";
import { nearestEdge } from "../src/react/Timeline";

const title = (animation?: Clip["text"] extends infer T ? T extends { animation?: infer A } ? A : never : never): Clip => ({
  id: "t", start_ms: 1000, duration_ms: 4000, fade_in_ms: 0, fade_out_ms: 0, x: 0, y: 0, scale: 1, opacity: 1, effects: [],
  text: { content: "Hello there world", font_size: 0.07, align: "center", weight: "bold", italic: false, color: "#ffffff", background: null, animation },
});

describe("title animations", () => {
  it("are fully shown between entry and exit", () => {
    const f = textFrame(title({ in: "from_below", out: "fade", in_ms: 500, out_ms: 500 }), 3000);
    expect([f.alpha, f.dy, f.scale, f.reveal, f.wipe]).toEqual([1, 0, 1, 1, 1]);
  });
  it("move in from below and fade out", () => {
    const c = title({ in: "from_below", out: "fade", in_ms: 500, out_ms: 500 });
    expect(textFrame(c, 1000).dy).toBeCloseTo(1.2);
    expect(textFrame(c, 1000).alpha).toBe(0);
    expect(textFrame(c, 4750).alpha).toBeGreaterThan(0);
    expect(textFrame(c, 4750).alpha).toBeLessThan(1);
  });
  it("type letter by letter, or word by word, keeping the lines", () => {
    expect(revealLines(["Hello", "world"], 0.5, "letters")).toEqual(["Hello", ""]);
    expect(revealLines(["one two", "three four"], 0.5, "words")).toEqual(["one two", ""]);
    expect(revealLines(["one two", "three four"], 0.75, "words")).toEqual(["one two", "three"]);
  });
  it("never let entry and exit overlap on a short title", () => {
    const c = { ...title({ in: "fade", out: "fade", in_ms: 3000, out_ms: 3000 }), duration_ms: 1000 };
    expect(textFrame(c, 1500).alpha).toBeCloseTo(1);
  });
});

describe("text styles", () => {
  it("make a title at a time, on the text track, and restyle one keeping its words", () => {
    const neon = DEFAULT_TEXT_PRESETS.find((p) => p.id === "neon")!;
    const r = addStyledTitle(emptyTimeline(), 2000, neon, "Hi");
    const c = findClip(r.timeline, r.clipId)!;
    expect([c.track.kind, c.clip.start_ms, c.clip.text!.shadow, c.clip.text!.content]).toEqual(["text", 2000, "glow", "Hi"]);
    const lower = DEFAULT_TEXT_PRESETS.find((p) => p.id === "lower_third")!;
    const restyled = findClip(applyTextPreset(r.timeline, r.clipId, lower), r.clipId)!.clip;
    expect([restyled.text!.content, restyled.text!.background, restyled.y]).toEqual(["Hi", "#111111", 0.62]);
  });
  it("use the host's fonts and colours, or the system ones", () => {
    expect(resolveConfig().text.fonts[0]!.id).toBe("system");
    const c = resolveConfig({ text: { fonts: [{ id: "inter", label: "Inter", family: "Inter", category: "sans" }], colours: [{ value: "#123456", name: "Brand" }] } });
    expect(c.text.fonts.map((f) => f.id)).toEqual(["inter"]);
    expect(c.text.colours[0]!.name).toBe("Brand");
  });
});

describe("the playhead", () => {
  it("snaps to the nearest clip edge within reach, else stays where it was put", () => {
    let tl = emptyTimeline();
    tl = { ...tl, tracks: tl.tracks.map((t) => (t.kind === "video" ? { ...t, clips: [{ ...title(), id: "a", text: undefined, start_ms: 1000, duration_ms: 2000 }] } : t)) };
    expect(nearestEdge(tl, 2950, 100)).toBe(3000);
    expect(nearestEdge(tl, 1080, 100)).toBe(1000);
    expect(nearestEdge(tl, 2000, 100)).toBeNull();
  });
});
