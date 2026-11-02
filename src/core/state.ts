/**
 * The editor's state with undo and redo (ADR 0068). Pure, so it is unit-tested
 * (tests/videoState.test.ts). A drag or a slider produces many small changes: `live` shows each
 * without touching the history, and `commit` records the state from before the gesture as one
 * undo step. A plain `edit` is one step.
 */

import type { Timeline } from "./timeline";

export interface EditorState {
  timeline: Timeline;
  past: Timeline[];
  future: Timeline[];
  selected: string | null;
  /** Bumped by every change to the timeline, so autosave knows there is something to save. */
  revision: number;
}

export type EditorAction =
  | { type: "edit"; timeline: Timeline; select?: string | null }
  | { type: "live"; timeline: Timeline }
  | { type: "commit"; before: Timeline }
  | { type: "select"; id: string | null }
  | { type: "undo" }
  | { type: "redo" };

export const HISTORY_LIMIT = 100;

export function initialState(timeline: Timeline): EditorState {
  return { timeline, past: [], future: [], selected: null, revision: 0 };
}

function stillThere(timeline: Timeline, id: string | null): string | null {
  if (!id) return null;
  return timeline.tracks.some((t) => t.clips.some((c) => c.id === id)) ? id : null;
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit":
      if (action.timeline === state.timeline) return state;
      return {
        timeline: action.timeline,
        past: [...state.past, state.timeline].slice(-HISTORY_LIMIT),
        future: [],
        selected: action.select === undefined ? stillThere(action.timeline, state.selected) : action.select,
        revision: state.revision + 1,
      };
    case "live":
      return { ...state, timeline: action.timeline, selected: stillThere(action.timeline, state.selected), revision: state.revision + 1 };
    case "commit":
      if (action.before === state.timeline) return state;
      return { ...state, past: [...state.past, action.before].slice(-HISTORY_LIMIT), future: [] };
    case "select":
      return { ...state, selected: action.id };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { timeline: previous, past: state.past.slice(0, -1), future: [state.timeline, ...state.future], selected: stillThere(previous, state.selected), revision: state.revision + 1 };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { timeline: next, past: [...state.past, state.timeline], future: state.future.slice(1), selected: stillThere(next, state.selected), revision: state.revision + 1 };
    }
  }
}

/** Standard picture sizes offered in the project settings. */
export const SIZES: { id: string; label: string; width: number; height: number }[] = [
  { id: "hd", label: "Widescreen HD, 1280 × 720", width: 1280, height: 720 },
  { id: "fhd", label: "Widescreen full HD, 1920 × 1080", width: 1920, height: 1080 },
  { id: "square", label: "Square, 1080 × 1080", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait (phones), 1080 × 1920", width: 1080, height: 1920 },
  { id: "sd", label: "Standard, 960 × 720 (4:3)", width: 960, height: 720 },
];

export function sizeId(width: number, height: number, sizes: readonly { id: string; width: number; height: number }[] = SIZES): string {
  return sizes.find((s) => s.width === width && s.height === height)?.id ?? "custom";
}

/** A centred crop of the given shape for a source of the given size (fractions of the source). */
export function cropToRatio(sourceWidth: number, sourceHeight: number, ratio: number): { x: number; y: number; w: number; h: number } {
  if (!sourceWidth || !sourceHeight || !ratio) return { x: 0, y: 0, w: 1, h: 1 };
  const sourceRatio = sourceWidth / sourceHeight;
  if (Math.abs(sourceRatio - ratio) < 0.001) return { x: 0, y: 0, w: 1, h: 1 };
  if (sourceRatio > ratio) {
    const w = ratio / sourceRatio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = sourceRatio / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}
