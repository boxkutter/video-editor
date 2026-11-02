/**
 * How the editor talks to the host application. The editor never knows where media or projects
 * live: the host supplies these functions. Only `uploadMedia` and `mediaUrl` are needed to edit;
 * the rest are optional, and each missing one turns its feature off (no `uploadExport`, no export).
 */

import type { Asset, AssetKind, Timeline } from "./timeline";

/** A file the host already holds, offered by `pickMedia` or returned by an upload. */
export interface MediaRef {
  /** The host's own identifier: stored in the timeline and given back to `mediaUrl`. */
  ref: string;
  name?: string;
  kind: AssetKind;
  /** Known length in milliseconds, so the editor need not probe the file. */
  durationMs?: number;
}

export interface Project {
  id?: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  timeline: Timeline;
}

export interface SaveResult {
  /** The host's version marker (for its own conflict checks). Opaque to the editor. */
  version?: string | number;
}

export interface EditorAdapter {
  /** Store a file the person added or recorded; resolve with the host's reference to it. */
  uploadMedia?: (file: File, kind: AssetKind, onProgress: (fraction: number) => void) => Promise<MediaRef>;
  /** A URL the browser can play for an asset. Must support Range requests for seeking. */
  mediaUrl: (asset: Pick<Asset, "ref" | "kind" | "name">) => string;
  /** Choose from the host's own media library. */
  pickMedia?: (kinds: AssetKind[]) => Promise<MediaRef[]>;
  /** Save the project (called by autosave and Save). Throw to report a failure. */
  saveProject?: (project: Project) => Promise<SaveResult | void>;
  /** Store the finished video. Without this the Export feature is off. */
  uploadExport?: (file: File, onProgress: (fraction: number) => void, project: Project) => Promise<MediaRef>;
  /** Called after a successful export, with the stored file. */
  onExported?: (media: MediaRef, project: Project) => void | Promise<void>;
  /** Called with every change to the project (after the editor's own state has updated). */
  onChange?: (project: Project) => void;
  /** Called with a problem the editor could not handle, for the host's own logging. */
  onError?: (error: Error) => void;
}
