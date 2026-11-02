import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VideoEditor } from "../src/react";
import { emptyTimeline } from "../src/core/timeline";

const adapter = { mediaUrl: () => "x", uploadMedia: async () => ({ ref: "r", kind: "video" as const }) };
const project = { title: "Demo", width: 1280, height: 720, fps: 30, timeline: emptyTimeline() };
const html = (props: Record<string, unknown> = {}) => renderToString(<VideoEditor project={project} adapter={adapter} {...props} />);

describe("the editor renders what is configured", () => {
  it("shows everything by default", () => {
    const out = html();
    for (const word of ["Upload video, audio or pictures", "Record from this computer", "Split", "Add title", "Undo", "Preview"]) expect(out).toContain(word);
    expect(out).not.toContain("Make the video"); // no uploadExport in the adapter
  });

  it("puts media on tabs, with the library in place when the host can list it", () => {
    const out = html({ adapter: { ...adapter, listMedia: async () => [] }, options: { features: { library: true } } });
    expect(out).toContain('role="tablist"');
    for (const word of [">Project<", ">Library<", ">Upload<", ">Record<", ">Effects<"]) expect(out).toContain(word);
    // an empty project opens on the library
    expect(out).toMatch(/aria-selected="true"[^>]*>Library/);
    const plain = html({ options: { features: { record: false, effects: false, fades: false, library: false } } });
    expect(plain).not.toContain(">Record<");
    expect(plain).not.toContain(">Effects<");
  });

  it("offers text styles, insert or replace, and snapping", () => {
    const out = html({ adapter: { ...adapter, listMedia: async () => [] }, options: { features: { library: true } } });
    expect(out).toContain(">Text<");
    expect(out).toContain("Big and bold");
    expect(out).toMatch(/aria-pressed="true"[^>]*>Snap/);
    expect(out).toContain('role="slider"');
    // insert or replace sits with the timeline's tools
    expect(out).toMatch(/aria-label="Editing tools"[\s\S]*role="radiogroup" aria-label="When adding"/);
  });

  it("hides the timeline's transport and screen when asked (the review player takes their place)", async () => {
    const css = (await import("node:fs")).readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toContain(".ve-transport[hidden]");
  });

  it("puts the host's content at the start of the top bar", () => {
    expect(html({ barStart: <a href="/videos">All videos</a> })).toMatch(/ve-topbar__start"><a href="\/videos">All videos/);
  });

  it("leaves out what is switched off", () => {
    const out = html({ options: { features: { record: false, titles: false, split: false, history: false, mediaPanel: false } } });
    for (const word of ["Record from this computer", "Add title", "Split", "Undo", "Upload video"]) expect(out).not.toContain(word);
    expect(out).toContain("Timeline");
  });

  it("uses the host's words and class names", () => {
    const out = html({ labels: { split: "Cut here" }, classNames: { root: "acme-editor" }, className: "mine" });
    expect(out).toContain("Cut here");
    expect(out).toContain("acme-editor");
    expect(out).toContain("mine");
  });

  it("offers export only when the adapter can store a video", () => {
    const out = html({ adapter: { ...adapter, uploadExport: async () => ({ ref: "v", kind: "video" as const }) } });
    expect(out).toContain("Make the video");
  });

  it("without uploadMedia offers no upload or recording", () => {
    const out = html({ adapter: { mediaUrl: () => "x" } });
    expect(out).not.toContain("Upload video");
    expect(out).not.toContain("Record from this computer");
  });

  it("plays an export from its own url when the host gives one, else through mediaUrl", () => {
    const withExport = { adapter: { ...adapter, uploadExport: async () => ({ ref: "v", kind: "video" as const }) } };
    expect(html({ ...withExport, existingExport: { ref: "v1", kind: "video", url: "blob:local-copy" } })).toContain('src="blob:local-copy"');
    expect(html({ ...withExport, adapter: { ...withExport.adapter, mediaUrl: () => "/m/v1" }, existingExport: { ref: "v1", kind: "video" } })).toContain('src="/m/v1"');
  });

  it("is a workspace by default, with a slim top bar, and can be one column", () => {
    const out = html();
    expect(out).toContain('data-layout="workspace"');
    expect(out).toContain("ve-topbar");
    expect(out).toContain("1280 × 720 · 30 fps"); // size and frame rate in the top bar, changed in a popover
    expect(html({ options: { layout: "stacked" } })).toContain('data-layout="stacked"');
  });
});
