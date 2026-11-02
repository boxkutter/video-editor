import type { DragEvent } from "react";
import type { MediaRef } from "../core/adapter";
import { LOOKS, TRANSITIONS, type LookId, type TransitionId } from "../core/styles";

/** What is dragged from the media panel onto the timeline: a project asset, a library file, or a look or transition (onto a clip). */
export type DragPayload = { asset: string } | { media: MediaRef } | { look: LookId } | { transition: TransitionId } | { text: string };

export const DRAG_TYPE = "application/x-boxkutter-media";
/** Also set for a look or transition, so the timeline can tell while dragging (it cannot read the data until the drop). */
export const STYLE_TYPE = "application/x-boxkutter-style";
/** Also set for a text style: dropped on a lane it adds a title, dropped on a title it restyles it. */
export const TEXT_TYPE = "application/x-boxkutter-text";

export function setDrag(event: DragEvent, payload: DragPayload, label: string) {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
  if ("look" in payload || "transition" in payload) event.dataTransfer.setData(STYLE_TYPE, "1");
  if ("text" in payload) event.dataTransfer.setData(TEXT_TYPE, "1");
  event.dataTransfer.setData("text/plain", label);
  event.dataTransfer.effectAllowed = "copy";
}

export function isMediaDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(DRAG_TYPE);
}

export function isStyleDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(STYLE_TYPE);
}

export function isTextDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(TEXT_TYPE);
}

export function readDrag(event: DragEvent): DragPayload | null {
  try {
    const raw = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as DragPayload;
    if ("asset" in raw && typeof raw.asset === "string") return { asset: raw.asset };
    if ("text" in raw && typeof raw.text === "string" && raw.text.length <= 80) return { text: raw.text };
    if ("look" in raw && typeof raw.look === "string" && raw.look in LOOKS) return { look: raw.look };
    if ("transition" in raw && (TRANSITIONS as readonly string[]).includes(raw.transition)) return { transition: raw.transition };
    if ("media" in raw && raw.media && typeof raw.media.ref === "string" && ["video", "audio", "image"].includes(raw.media.kind)) return { media: raw.media };
  } catch {
    /* not ours */
  }
  return null;
}
