/**
 * Everything a host can switch on, off or change. Every feature is an option; `resolveConfig`
 * fills in the defaults, so a host passes only what differs. Pure and framework-free, so the
 * React UI, the web component and any other UI built on the core read the same configuration.
 */

import type { AssetKind, EffectType } from "./timeline";
import { EFFECTS } from "./timeline";
import type { CaptureMode } from "./capture";

export interface FeatureOptions {
  /** Upload media from the computer. `accept` narrows the file types. */
  upload: boolean | { kinds?: AssetKind[]; accept?: string };
  /** Record from the computer. Choose which sources are offered. */
  record: boolean | { camera?: boolean; screen?: boolean; microphone?: boolean };
  /** Pick media from the host's own library (needs `adapter.pickMedia`). */
  library: boolean;
  /** Cut a clip in two at the playhead. */
  split: boolean;
  /** Trim by dragging, by the playhead and by typing. */
  trim: boolean;
  /** Crop, with aspect presets. */
  crop: boolean | { presets?: [label: string, ratio: number][] };
  /** Speed change. */
  speed: boolean;
  /** Fade in and out. */
  fades: boolean;
  /** Volume. */
  volume: boolean;
  /** Position, size and opacity. */
  placement: boolean;
  /** Effects: true for all, or the list to offer. */
  effects: boolean | EffectType[];
  /** Titles and on-screen text. */
  titles: boolean;
  /** Add and remove tracks, mute and hide them. */
  tracks: boolean;
  /** Align, close gaps, ripple delete, duplicate. */
  arrange: boolean;
  /** Undo and redo. */
  history: boolean;
  /** Zoom the timeline. */
  zoom: boolean;
  /** Make the finished video. */
  export: boolean;
  /** The preview, transport and position slider. */
  preview: boolean;
  /** The media panel as a whole. */
  mediaPanel: boolean;
  /** The inspector (clip settings) as a whole. */
  inspector: boolean;
  /** Title and picture-size settings bar. */
  projectBar: boolean;
}

export interface LimitOptions {
  maxDurationMs: number;
  maxTracks: number;
  maxClips: number;
  maxAssets: number;
  /** Largest file accepted for upload, in bytes. */
  maxUploadBytes: number;
}

export interface CanvasOptions {
  width: number;
  height: number;
  fps: number;
  /** Sizes offered when `features.projectBar` is on. */
  sizes: { id: string; label: string; width: number; height: number }[];
  fpsChoices: number[];
}

export interface EditorConfig {
  features: FeatureOptions;
  limits: LimitOptions;
  canvas: CanvasOptions;
  /** Autosave: the delay in milliseconds after the last change, or false to save only on request. */
  autosave: number | false;
  /** Pixels per second the timeline starts at. */
  zoom: number;
  /** Set when the host serves media from another origin: needed to read it onto the canvas. */
  crossOrigin?: "anonymous" | "use-credentials";
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type EditorOptions = DeepPartial<EditorConfig>;

export const DEFAULT_SIZES: CanvasOptions["sizes"] = [
  { id: "hd", label: "Widescreen HD, 1280 × 720", width: 1280, height: 720 },
  { id: "fhd", label: "Widescreen full HD, 1920 × 1080", width: 1920, height: 1080 },
  { id: "square", label: "Square, 1080 × 1080", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait (phones), 1080 × 1920", width: 1080, height: 1920 },
  { id: "sd", label: "Standard, 960 × 720 (4:3)", width: 960, height: 720 },
];

export const DEFAULT_PRESETS: [string, number][] = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["9:16", 9 / 16],
];

export const DEFAULT_CONFIG: EditorConfig = {
  features: {
    upload: true,
    record: true,
    library: false,
    split: true,
    trim: true,
    crop: true,
    speed: true,
    fades: true,
    volume: true,
    placement: true,
    effects: true,
    titles: true,
    tracks: true,
    arrange: true,
    history: true,
    zoom: true,
    export: true,
    preview: true,
    mediaPanel: true,
    inspector: true,
    projectBar: true,
  },
  limits: { maxDurationMs: 2 * 60 * 60 * 1000, maxTracks: 12, maxClips: 400, maxAssets: 100, maxUploadBytes: 2 * 1024 ** 3 },
  canvas: { width: 1280, height: 720, fps: 30, sizes: DEFAULT_SIZES, fpsChoices: [24, 25, 30, 60] },
  autosave: 1500,
  zoom: 60,
};

/** The configuration with every default filled in. Unknown feature names are ignored. */
export function resolveConfig(options: EditorOptions = {}): EditorConfig {
  const features = { ...DEFAULT_CONFIG.features };
  for (const key of Object.keys(features) as (keyof FeatureOptions)[]) {
    const given = options.features?.[key];
    if (given !== undefined) (features as Record<string, unknown>)[key] = given;
  }
  const canvas = { ...DEFAULT_CONFIG.canvas, ...options.canvas } as CanvasOptions;
  canvas.sizes = (options.canvas?.sizes as CanvasOptions["sizes"] | undefined) ?? DEFAULT_CONFIG.canvas.sizes;
  canvas.fpsChoices = (options.canvas?.fpsChoices as number[] | undefined) ?? DEFAULT_CONFIG.canvas.fpsChoices;
  return {
    features,
    limits: { ...DEFAULT_CONFIG.limits, ...options.limits },
    canvas,
    autosave: options.autosave === undefined ? DEFAULT_CONFIG.autosave : options.autosave,
    zoom: options.zoom ?? DEFAULT_CONFIG.zoom,
    crossOrigin: options.crossOrigin,
  };
}

export function featureOn(value: boolean | object): boolean {
  return value !== false;
}

/** Which kinds of file the upload control accepts. */
export function uploadKinds(config: EditorConfig): AssetKind[] {
  const u = config.features.upload;
  if (!u) return [];
  return (typeof u === "object" && u.kinds) || ["video", "audio", "image"];
}

export function uploadAccept(config: EditorConfig): string {
  const u = config.features.upload;
  if (typeof u === "object" && u.accept) return u.accept;
  const map = { video: "video/*", audio: "audio/*", image: "image/png,image/jpeg,image/gif,image/webp" } as const;
  return uploadKinds(config).map((k) => map[k]).join(",");
}

/** The recording sources on offer, in order. */
export function recordModes(config: EditorConfig): CaptureMode[] {
  const r = config.features.record;
  if (!r) return [];
  const on = typeof r === "object" ? r : {};
  const all: [CaptureMode, boolean][] = [
    ["camera", on.camera !== false],
    ["screen", on.screen !== false],
    ["microphone", on.microphone !== false],
  ];
  return all.filter(([, enabled]) => enabled).map(([mode]) => mode);
}

export function effectsOffered(config: EditorConfig): (keyof typeof EFFECTS)[] {
  const e = config.features.effects;
  if (!e) return [];
  return e === true ? (Object.keys(EFFECTS) as (keyof typeof EFFECTS)[]) : e.filter((x) => x in EFFECTS);
}

export function cropPresets(config: EditorConfig): [string, number][] {
  const c = config.features.crop;
  if (!c) return [];
  return (typeof c === "object" && c.presets) || DEFAULT_PRESETS;
}
