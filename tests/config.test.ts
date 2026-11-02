import { describe, expect, it } from "vitest";
import { cropPresets, effectsOffered, recordModes, resolveConfig, uploadAccept, uploadKinds } from "../src/core/config";
import { createT } from "../src/core/labels";

describe("configuration", () => {
  it("has everything on by default", () => {
    const c = resolveConfig();
    expect(Object.entries(c.features).filter(([k, v]) => !v && k !== "library")).toEqual([]);
    expect(recordModes(c)).toEqual(["camera", "screen", "microphone"]);
    expect(effectsOffered(c)).toHaveLength(8);
  });

  it("changes only what the host names", () => {
    const c = resolveConfig({ features: { record: { screen: false }, effects: ["grayscale", "blur"], upload: { kinds: ["video"] }, titles: false }, limits: { maxTracks: 3 }, autosave: false });
    expect(recordModes(c)).toEqual(["camera", "microphone"]);
    expect(effectsOffered(c)).toEqual(["grayscale", "blur"]);
    expect(uploadKinds(c)).toEqual(["video"]);
    expect(uploadAccept(c)).toBe("video/*");
    expect(c.features.titles).toBe(false);
    expect(c.features.split).toBe(true);
    expect(c.limits.maxTracks).toBe(3);
    expect(c.limits.maxClips).toBe(400);
    expect(c.autosave).toBe(false);
  });

  it("turns whole groups off and takes custom crop presets and sizes", () => {
    const c = resolveConfig({ features: { record: false, upload: false, effects: false, crop: { presets: [["Banner", 3]] } }, canvas: { sizes: [{ id: "x", label: "X", width: 640, height: 360 }] } });
    expect(recordModes(c)).toEqual([]);
    expect(uploadKinds(c)).toEqual([]);
    expect(effectsOffered(c)).toEqual([]);
    expect(cropPresets(c)).toEqual([["Banner", 3]]);
    expect(c.canvas.sizes).toHaveLength(1);
    expect(c.canvas.fpsChoices).toContain(30);
  });
});

describe("labels", () => {
  it("rewords and fills in placeholders", () => {
    const t = createT({ play: "Lecture" });
    expect(t("play")).toBe("Lecture");
    expect(t("pause")).toBe("Pause");
    expect(t("uploading", { name: "a.mp4" })).toBe("Uploading a.mp4…");
  });
});
