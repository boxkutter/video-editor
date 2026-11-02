import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { assetOf, clipEnd, formatTime, moveClip, removeClip, removeTrack, snap, spokenDuration, trimEnd, trimStart, updateTrack, type Clip, type Timeline, type Track } from "../core/timeline";
import { useCx, useEditor } from "./context";
import { isMediaDrag, isStyleDrag, readDrag, type DragPayload } from "./drag";

interface Props {
  timeline: Timeline;
  selected: string | null;
  playhead: number;
  zoom: number;
  onSelect: (id: string | null) => void;
  onSeek: (ms: number) => void;
  onLive: (next: Timeline) => void;
  onCommit: (before: Timeline) => void;
  onEdit: (next: Timeline, select?: string | null) => void;
  /** Something from the media panel was dropped: media on a track at a time, or a look or transition on a clip. */
  onDrop: (payload: DragPayload, place: { trackId: string; at: number; clipId: string | null }) => void;
}

type Drag = { mode: "move" | "start" | "end"; clipId: string; originX: number; before: Timeline; start: number; end: number; moved: boolean };
const LABEL_WIDTH = 150;
const ROW_HEIGHT = 46;

function tickStep(zoom: number): number {
  const wanted = 70 / zoom;
  return [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s >= wanted) ?? 600;
}

/** The timeline: a row per track, clips you can select, drag, trim by their ends, or move with the arrow keys. */
export function TimelinePanel({ timeline, selected, playhead, zoom, onSelect, onSeek, onLive, onCommit, onEdit, onDrop }: Props) {
  const { config, t } = useEditor();
  const cx = useCx();
  const drag = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canTrim = config.features.trim;
  const end = Math.max(30_000, ...timeline.tracks.flatMap((tr) => tr.clips.map(clipEnd))) + 10_000;
  const width = (end / 1000) * zoom;
  const px = (ms: number) => (ms / 1000) * zoom;
  const ms = (pixels: number) => (pixels / zoom) * 1000;
  const rows = [...timeline.tracks].reverse();
  const step = tickStep(zoom);
  const ticks = Array.from({ length: Math.floor(end / 1000 / step) + 1 }, (_, i) => i * step);
  const kindName = { video: t("trackVideo"), audio: t("trackAudio"), text: t("trackText") } as const;
  const nameOf = (clip: Clip) => (clip.text ? clip.text.content.replace(/\s+/g, " ").slice(0, 40) : (assetOf(timeline, clip)?.name ?? t("clipHeading")));

  // Where a drag from the media panel would land: a place on a track, or (for a look) a clip.
  const [target, setTarget] = useState<{ trackId: string; at: number; clipId: string | null; style: boolean } | null>(null);

  function placeOf(event: DragEvent<HTMLElement>, trackId: string) {
    const lane = event.currentTarget.getBoundingClientRect();
    const at = snap(timeline, Math.max(0, ms(event.clientX - lane.left)), playhead, null, ms(8));
    const clipId = (event.target as HTMLElement).closest<HTMLElement>("[data-clip-id]")?.dataset.clipId ?? null;
    return { trackId, at: Math.round(at), clipId };
  }

  function dragOver(event: DragEvent<HTMLElement>, trackId: string) {
    if (!isMediaDrag(event)) return;
    const style = isStyleDrag(event);
    const place = placeOf(event, trackId);
    if (style && !place.clipId) { event.dataTransfer.dropEffect = "none"; setTarget(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!target || target.trackId !== place.trackId || target.clipId !== place.clipId || Math.abs(target.at - place.at) > 20) setTarget({ ...place, style });
  }

  function drop(event: DragEvent<HTMLElement>, trackId: string) {
    const payload = readDrag(event);
    setTarget(null);
    if (!payload) return;
    event.preventDefault();
    onDrop(payload, placeOf(event, trackId));
  }

  function seekFrom(event: { clientX: number }) {
    const rect = scroller.current?.getBoundingClientRect();
    if (rect) onSeek(Math.max(0, ms(event.clientX - rect.left - LABEL_WIDTH + (scroller.current?.scrollLeft ?? 0))));
  }

  function down(event: PointerEvent<HTMLElement>, clip: Clip, mode: Drag["mode"]) {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(clip.id);
    drag.current = { mode, clipId: clip.id, originX: event.clientX, before: timeline, start: clip.start_ms, end: clipEnd(clip), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveEvent(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || (!d.moved && Math.abs(event.clientX - d.originX) < 3)) return;
    d.moved = true;
    const delta = ms(event.clientX - d.originX);
    const threshold = ms(8);
    const base = d.before;
    if (d.mode === "move") {
      const at = snap(base, d.start + delta, playhead, d.clipId, threshold);
      const atEnd = snap(base, d.end + delta, playhead, d.clipId, threshold);
      const chosen = Math.abs(at - (d.start + delta)) <= Math.abs(atEnd - (d.end + delta)) ? at : atEnd - (d.end - d.start);
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
      onLive(moveClip(base, d.clipId, chosen, over));
    } else if (d.mode === "start") onLive(trimStart(base, d.clipId, snap(base, d.start + delta, playhead, d.clipId, threshold)));
    else onLive(trimEnd(base, d.clipId, snap(base, d.end + delta, playhead, d.clipId, threshold)));
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onCommit(d.before);
  }

  function key(event: KeyboardEvent<HTMLElement>, clip: Clip) {
    const nudge = event.shiftKey ? 1000 : 100;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onEdit(moveClip(timeline, clip.id, clip.start_ms + (event.key === "ArrowLeft" ? -nudge : nudge)));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onEdit(removeClip(timeline, clip.id), null);
    }
  }

  const btn2 = cx("buttonSecondary", "ve-button ve-button--secondary ve-track__btn");
  return (
    <div className={cx("timeline", "ve-timeline")} ref={scroller} role="group" aria-label={t("timeline")} style={{ ["--ve-label" as string]: `${LABEL_WIDTH}px` }}>
      <div className="ve-timeline__inner" style={{ width: width + LABEL_WIDTH }}>
        <div className="ve-timeline__ruler" onClick={seekFrom} aria-hidden="true">
          <span className="ve-timeline__corner" />
          {ticks.map((s) => (
            <span key={s} className="ve-timeline__tick" style={{ left: LABEL_WIDTH + px(s * 1000) }}>
              {formatTime(s * 1000, false)}
            </span>
          ))}
        </div>
        {rows.map((track: Track) => (
          <div key={track.id} className="ve-track" data-kind={track.kind} data-track-id={track.id} style={{ height: ROW_HEIGHT }}>
            <div className="ve-track__label">
              <span className="ve-track__name" title={track.name}>{track.name || kindName[track.kind]}</span>
              {config.features.tracks && track.kind !== "text" ? (
                <button type="button" className={btn2} aria-pressed={track.muted} onClick={() => onEdit(updateTrack(timeline, track.id, { muted: !track.muted }))}>
                  {track.muted ? t("unmute") : t("mute")}
                  <span className="ve-visually-hidden"> {track.name}</span>
                </button>
              ) : null}
              {config.features.tracks && track.kind !== "audio" ? (
                <button type="button" className={btn2} aria-pressed={track.hidden} onClick={() => onEdit(updateTrack(timeline, track.id, { hidden: !track.hidden }))}>
                  {track.hidden ? t("show") : t("hide")}
                  <span className="ve-visually-hidden"> {track.name}</span>
                </button>
              ) : null}
              {config.features.tracks && track.clips.length === 0 ? (
                <button type="button" className={btn2} onClick={() => onEdit(removeTrack(timeline, track.id))}>
                  {t("removeTrack")}
                  <span className="ve-visually-hidden"> {t("trackWord")} {track.name}</span>
                </button>
              ) : null}
            </div>
            <div className="ve-track__lane" style={{ width }} onClick={(e) => { onSelect(null); seekFrom(e); }}
              data-drop={target?.trackId === track.id || undefined}
              onDragOver={(e) => dragOver(e, track.id)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTarget(null); }} onDrop={(e) => drop(e, track.id)}>
              {target?.trackId === track.id && !target.style ? (
                <span className="ve-drop-marker" style={{ left: px(target.at) }} aria-hidden="true">
                  <span className="ve-drop-marker__time">{formatTime(target.at)}</span>
                </span>
              ) : null}
              {track.clips.map((clip) => (
                <div key={clip.id} className="ve-clip-wrap" data-clip-id={clip.id} data-drop={(target?.style && target.clipId === clip.id) || undefined} style={{ left: px(clip.start_ms), width: Math.max(6, px(clip.duration_ms)) }}>
                  <button
                    type="button"
                    className={cx("clip", "ve-clip")}
                    data-selected={selected === clip.id}
                    data-kind={track.kind}
                    aria-pressed={selected === clip.id}
                    aria-label={t("clipDescription", { name: nameOf(clip), kind: kindName[track.kind].toLowerCase(), track: track.name, start: spokenDuration(clip.start_ms), length: spokenDuration(clip.duration_ms) })}
                    onClick={(e) => { e.stopPropagation(); onSelect(clip.id); }}
                    onPointerDown={(e) => down(e, clip, "move")}
                    onPointerMove={moveEvent}
                    onPointerUp={up}
                    onPointerCancel={up}
                    onKeyDown={(e) => key(e, clip)}
                  >
                    <span className="ve-clip__name">{nameOf(clip)}</span>
                  </button>
                  {canTrim ? (
                    <>
                      <span className="ve-clip__handle ve-clip__handle--start" aria-hidden="true" onPointerDown={(e) => down(e, clip, "start")} onPointerMove={moveEvent} onPointerUp={up} onPointerCancel={up} />
                      <span className="ve-clip__handle ve-clip__handle--end" aria-hidden="true" onPointerDown={(e) => down(e, clip, "end")} onPointerMove={moveEvent} onPointerUp={up} onPointerCancel={up} />
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="ve-timeline__playhead" aria-hidden="true" style={{ left: LABEL_WIDTH + px(playhead), height: ROW_HEIGHT * rows.length + 28 }} />
      </div>
    </div>
  );
}
