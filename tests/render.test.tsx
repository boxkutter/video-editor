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
    for (const word of ["Upload video, audio or pictures", "Record from this computer", "Split at playhead", "Add title", "Undo", "Preview"]) expect(out).toContain(word);
    expect(out).not.toContain("Make the video"); // no uploadExport in the adapter
  });

  it("leaves out what is switched off", () => {
    const out = html({ options: { features: { record: false, titles: false, split: false, history: false, mediaPanel: false } } });
    for (const word of ["Record from this computer", "Add title", "Split at playhead", "Undo", "Upload video"]) expect(out).not.toContain(word);
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
});
