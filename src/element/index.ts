/**
 * `<video-editor>`: the editor as a web component, for hosts with no React (plain HTML, Vue,
 * Angular, Svelte, Capacitor or Ionic shells). React is bundled in. Import this file once, then:
 *
 *   const el = document.querySelector("video-editor");
 *   el.adapter = { mediaUrl, uploadMedia, saveProject, uploadExport };   // required, set as properties
 *   el.project = { title, width, height, fps, timeline };
 *   el.options = { features: { record: false } };                         // optional
 *   el.labels = { play: "Lecture" };                                      // optional
 *
 * The editor renders in the light DOM (not a shadow root) so the host's CSS variables and the
 * package's styles.css apply as usual and screen readers see a normal page. Set properties, not
 * attributes: they carry functions and objects. It fires a `ve-change` event with the project.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorAdapter, Project } from "../core/adapter";
import type { EditorOptions } from "../core/config";
import type { LabelOverrides } from "../core/labels";
import { VideoEditor, type VideoEditorHandle } from "../react/VideoEditor";

export class VideoEditorElement extends HTMLElement {
  private root: Root | null = null;
  private handle: VideoEditorHandle | null = null;
  private _adapter: EditorAdapter | null = null;
  private _project: Project | null = null;
  private _options: EditorOptions | undefined;
  private _labels: LabelOverrides | undefined;
  private projectKey = 0;

  get adapter(): EditorAdapter | null { return this._adapter; }
  set adapter(value: EditorAdapter | null) { this._adapter = value; this.render(); }
  get project(): Project | null { return this._project; }
  set project(value: Project | null) { this._project = value; this.projectKey += 1; this.render(); }
  get options(): EditorOptions | undefined { return this._options; }
  set options(value: EditorOptions | undefined) { this._options = value; this.render(); }
  get labels(): LabelOverrides | undefined { return this._labels; }
  set labels(value: LabelOverrides | undefined) { this._labels = value; this.render(); }

  /** The project as it is now. */
  getProject(): Project | null { return this.handle?.getProject() ?? null; }
  /** Save now through the adapter. */
  save(): Promise<void> { return this.handle?.save() ?? Promise.resolve(); }

  connectedCallback() { this.render(); }
  disconnectedCallback() { this.root?.unmount(); this.root = null; }

  private render() {
    if (!this.isConnected || !this._adapter || !this._project) return;
    this.root ??= createRoot(this);
    const adapter: EditorAdapter = {
      ...this._adapter,
      onChange: (project) => {
        this._adapter?.onChange?.(project);
        this.dispatchEvent(new CustomEvent("ve-change", { detail: project }));
      },
    };
    this.root.render(createElement(VideoEditor, { key: this.projectKey, ref: (h: VideoEditorHandle | null) => { this.handle = h; }, project: this._project, adapter, options: this._options, labels: this._labels }));
  }
}

export function defineVideoEditor(tag = "video-editor"): void {
  if (!customElements.get(tag)) customElements.define(tag, VideoEditorElement);
}

defineVideoEditor();
