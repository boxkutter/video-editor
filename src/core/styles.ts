/**
 * Ready-made looks (sets of effects) and transitions that can be dropped onto a clip. Both are
 * made of what a clip already has (effects, fade in and fade out), so nothing new is stored and
 * every host that reads the timeline understands them.
 */
import { EFFECTS, clipEnd, findClip, updateClip, type Clip, type Effect, type EffectType, type Timeline } from "./timeline";

export const LOOKS = {
  none: [],
  black_white: [{ type: "grayscale", amount: 1 }],
  warm: [{ type: "sepia", amount: 0.45 }, { type: "saturate", amount: 1.15 }],
  vivid: [{ type: "saturate", amount: 1.6 }, { type: "contrast", amount: 1.15 }],
  bright: [{ type: "brightness", amount: 1.25 }],
  moody: [{ type: "contrast", amount: 1.3 }, { type: "brightness", amount: 0.85 }, { type: "saturate", amount: 0.75 }],
  faded: [{ type: "contrast", amount: 0.8 }, { type: "saturate", amount: 0.7 }, { type: "brightness", amount: 1.1 }],
  soft: [{ type: "blur", amount: 3 }],
} satisfies Record<string, Effect[]>;
export type LookId = keyof typeof LOOKS;

export const TRANSITIONS = ["fade_in", "fade_out", "dip", "fade_both"] as const;
export type TransitionId = (typeof TRANSITIONS)[number];

/** How long a dropped fade lasts: a second, or half a short clip. */
export const FADE_MS = 1000;
const fadeFor = (clip: Clip) => Math.round(Math.min(FADE_MS, clip.duration_ms / 2));

/** Whether a clip can take a look: only clips with a picture (not sound, not titles). */
export function takesLook(timeline: Timeline, clipId: string): boolean {
  const found = findClip(timeline, clipId);
  return !!found && found.track.kind === "video";
}

/** Replace a clip's effects with a look's, keeping to the effects this editor offers. */
export function applyLook(timeline: Timeline, clipId: string, look: LookId, offered: readonly EffectType[] = Object.keys(EFFECTS) as EffectType[]): Timeline {
  if (!takesLook(timeline, clipId)) return timeline;
  const effects = (LOOKS[look] as Effect[]).filter((e) => offered.includes(e.type)).map((e) => ({ ...e }));
  return updateClip(timeline, clipId, { effects });
}

/**
 * Apply a transition. `fade_in`, `fade_out` and `fade_both` act on the clip itself. `dip` (through
 * black, or silence for sound) acts on the cut nearest `at`: this clip's end and the clip right after
 * it on the same track, or the clip right before it and this clip's start. With no neighbour at that
 * cut, only this clip fades.
 */
export function applyTransition(timeline: Timeline, clipId: string, transition: TransitionId, at?: number): Timeline {
  const found = findClip(timeline, clipId);
  if (!found) return timeline;
  const { clip, track } = found;
  if (transition === "fade_in") return updateClip(timeline, clipId, { fade_in_ms: fadeFor(clip) });
  if (transition === "fade_out") return updateClip(timeline, clipId, { fade_out_ms: fadeFor(clip) });
  if (transition === "fade_both") return updateClip(timeline, clipId, { fade_in_ms: fadeFor(clip), fade_out_ms: fadeFor(clip) });
  const point = at ?? clipEnd(clip);
  const atEnd = Math.abs(point - clipEnd(clip)) <= Math.abs(point - clip.start_ms);
  const touching = (a: number, b: number) => Math.abs(a - b) <= 100;
  if (atEnd) {
    const next = track.clips.find((c) => c.id !== clip.id && touching(c.start_ms, clipEnd(clip)));
    let out = updateClip(timeline, clip.id, { fade_out_ms: fadeFor(clip) });
    if (next) out = updateClip(out, next.id, { fade_in_ms: fadeFor(next) });
    return out;
  }
  const prev = track.clips.find((c) => c.id !== clip.id && touching(clipEnd(c), clip.start_ms));
  let out = updateClip(timeline, clip.id, { fade_in_ms: fadeFor(clip) });
  if (prev) out = updateClip(out, prev.id, { fade_out_ms: fadeFor(prev) });
  return out;
}
