import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { EditorAdapter, MediaRef, Project } from "../core/adapter";
import { effectsOffered, resolveConfig, type EditorOptions } from "../core/config";
import { probeUrl } from "../core/capture";
import { VideoEngine, supportsEditing } from "../core/engine";
import { createT, type LabelOverrides } from "../core/labels";
import { initialState, reduce, sizeId } from "../core/state";
import { applyLook, applyTransition, takesLook, type LookId, type TransitionId } from "../core/styles";
import { addStyledTitle, applyTextPreset } from "../core/text";
import { placeClip, type AddMode } from "../core/edits";
import { MAX_DURATION_MS, addAsset, addAssetClip, addTitle, addTrack, closeGaps, duplicateClip, emptyTimeline, findClip, formatTime, newId, removeClip, rippleRemove, splitClip, timelineEnd, updateClip, type Asset, type Timeline } from "../core/timeline";
import { withDuration } from "../core/webm";
import { EditorProvider, useCx, useEditor, type ClassNames } from "./context";
import { Inspector } from "./Inspector";
import { type DragPayload } from "./drag";
import { MediaPanel } from "./MediaPanel";
import { TimelinePanel } from "./Timeline";

export interface VideoEditorProps {
  /** The project to edit. Pass a new `key` to open a different one. */
  project: Project;
  adapter: EditorAdapter;
  /** Switch features on or off, set limits, sizes and autosave. See `EditorConfig`. */
  options?: EditorOptions;
  /** Reword or translate any text. */
  labels?: LabelOverrides;
  /** Extra class names for parts of the editor, to match the host's styles. */
  classNames?: ClassNames;
  className?: string;
  /** Rendered after the export controls once a video has been made (for example "Use in a course"). */
  exportActions?: (media: MediaRef, project: Project) => ReactNode;
  /** The video made earlier, shown under the export controls. */
  existingExport?: MediaRef | null;
  /** Content above the editor, inside its root. */
  header?: ReactNode;
  /** Changing this lists the host's library again (`adapter.listMedia`), for example after the host's rules for it change. */
  libraryKey?: unknown;
  /** Content at the start of the top bar, before the title (for example a link back to the host's list). */
  barStart?: ReactNode;
}

type Place = { at: number; trackId?: string; clipId?: string | null };

/** A file on its own in the preview, with the browser's own controls. */
function Review({ media, url }: { media: MediaRef; url: string }) {
  if (media.kind === "image") return <img className="ve-review__media" src={url} alt={media.name ?? ""} />;
  if (media.kind === "audio") return <audio className="ve-review__audio" src={url} controls autoPlay />;
  return <video className="ve-review__media" src={url} controls autoPlay playsInline />;
}

export interface VideoEditorHandle {
  getProject: () => Project;
  save: () => Promise<void>;
}

type Saving = "saved" | "dirty" | "saving" | "error";

/**
 * The editor. It owns the editing state; the host supplies storage through `adapter` and
 * shapes the editor through `options`, `labels`, `classNames` and CSS variables (`--ve-*`).
 */
export const VideoEditor = forwardRef<VideoEditorHandle, VideoEditorProps>(function VideoEditor(props, ref) {
  const config = useMemo(() => resolveConfig(props.options), [props.options]);
  const t = useMemo(() => createT(props.labels), [props.labels]);
  const value = useMemo(() => ({ config, adapter: props.adapter, t, classNames: props.classNames ?? {} }), [config, props.adapter, t, props.classNames]);
  return (
    <EditorProvider value={value}>
      <Editor {...props} handleRef={ref} />
    </EditorProvider>
  );
});

function Editor({ project, existingExport, exportActions, header, barStart, libraryKey, className, handleRef }: VideoEditorProps & { handleRef: React.Ref<VideoEditorHandle> }) {
  const { config, adapter, t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const f = config.features;
  const [state, dispatch] = useReducer(reduce, project.timeline, (tl) => initialState(tl.tracks.length ? tl : { ...tl, tracks: emptyTimeline().tracks }));
  const [title, setTitle] = useState(project.title);
  const [size, setSize] = useState({ width: project.width, height: project.height, fps: project.fps });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(config.zoom);
  const [saving, setSaving] = useState<Saving>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [exported, setExported] = useState<MediaRef | null>(existingExport ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>("insert");
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;
  /** A file shown in the preview for a look before it is used (the timeline is set aside meanwhile). */
  const [review, setReview] = useState<MediaRef | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // A host that finishes the video on its server passes the processed file later: show that one.
  const existingRef = existingExport?.ref;
  useEffect(() => {
    if (existingExport) setExported(existingExport);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the file, not the object identity
  }, [existingRef]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<VideoEngine | null>(null);
  const liveBefore = useRef<Timeline | null>(null);
  const savedRevision = useRef(0);
  const metaRevision = useRef(0);
  const savedMeta = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const current = (): Project => ({ id: project.id, title: title.trim() || t("untitled"), ...size, timeline: state.timeline });
  const currentRef = useRef(current);
  currentRef.current = current;
  const capable = useMemo(() => (typeof window === "undefined" ? ({ ok: true } as const) : supportsEditing()), []);

  const { timeline, selected } = state;
  const selection = findClip(timeline, selected);
  const duration = timelineEnd(timeline);
  const canSave = !!adapter.saveProject;

  useEffect(() => {
    if (!canvas.current || !capable.ok) return;
    const e = new VideoEngine((asset) => adapter.mediaUrl(asset), canvas.current, config.crossOrigin);
    e.resize(size.width, size.height);
    e.onTime = setTime;
    e.onEnded = () => setPlaying(false);
    engine.current = e;
    e.setTimeline(stateRef.current.timeline);
    return () => {
      e.dispose();
      engine.current = null;
    };
    // made once; size and timeline are pushed below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capable.ok]);
  useEffect(() => engine.current?.setTimeline(timeline), [timeline]);
  useEffect(() => engine.current?.resize(size.width, size.height), [size.width, size.height]);
  useEffect(() => engine.current?.setFonts(config.text.fonts), [config.text.fonts, capable.ok]);

  const save = useCallback(async () => {
    if (!adapter.saveProject) return;
    const at = stateRef.current.revision;
    const meta = metaRevision.current;
    setSaving("saving");
    try {
      await adapter.saveProject(currentRef.current());
      savedRevision.current = at;
      savedMeta.current = meta;
      setMessage(null);
      setSaving(stateRef.current.revision === at && metaRevision.current === meta ? "saved" : "dirty");
    } catch (error) {
      adapter.onError?.(error instanceof Error ? error : new Error(String(error)));
      setSaving("error");
      setMessage(error instanceof Error ? error.message : t("saveFailed"));
    }
  }, [adapter, t]);

  useImperativeHandle(handleRef, () => ({ getProject: () => currentRef.current(), save }), [save]);

  useEffect(() => {
    if (state.revision === 0 && metaRevision.current === 0) return;
    adapter.onChange?.(currentRef.current());
    if (!canSave) return;
    if (state.revision === savedRevision.current && metaRevision.current === savedMeta.current) return;
    setSaving("dirty");
    if (config.autosave === false) return;
    const timer = setTimeout(() => void save(), config.autosave);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.revision, title, size]);

  useEffect(() => {
    if (!canSave) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (stateRef.current.revision !== savedRevision.current || metaRevision.current !== savedMeta.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [canSave]);

  const edit = useCallback((next: Timeline, select?: string | null) => dispatch({ type: "edit", timeline: next, select }), []);
  const live = useCallback((next: Timeline) => {
    liveBefore.current ??= stateRef.current.timeline;
    dispatch({ type: "live", timeline: next });
  }, []);
  const commit = useCallback((before?: Timeline) => {
    const b = before ?? liveBefore.current;
    liveBefore.current = null;
    if (b) dispatch({ type: "commit", before: b });
  }, []);

  // Media arrives after an upload or a probe, so these read the timeline as it is then, not as it was.
  function placeAsset(asset: Asset, addToTimeline: boolean, place?: Place) {
    const timeline = stateRef.current.timeline;
    if (timeline.assets.length >= config.limits.maxAssets) return setMessage(t("fileRefused", { name: asset.name }));
    let next = addAsset(timeline, asset);
    let select: string | null | undefined;
    if (addToTimeline) {
      const placed = place ? placeClip(next, asset.id, place.at, addModeRef.current, place) : addAssetClip(next, asset.id, asset.kind === "audio" ? time : 0);
      if (placed) { next = placed.timeline; select = placed.clipId; }
    }
    edit(next, select);
  }

  /** A library file onto the timeline (at the playhead, or where it was dropped); added to the project once. */
  async function addMedia(media: MediaRef, place?: Place) {
    setMessage(null);
    const at = place ?? { at: time };
    const known = stateRef.current.timeline.assets.find((a) => a.ref === media.ref && a.kind === media.kind);
    if (known) {
      const placed = placeClip(stateRef.current.timeline, known.id, at.at, addModeRef.current, at);
      if (placed) edit(placed.timeline, placed.clipId);
      return;
    }
    let durationMs = media.durationMs ?? 0;
    let width = 0;
    let height = 0;
    if (media.kind !== "image" && !durationMs) {
      const probed = await probeUrl(media.url ?? adapter.mediaUrl({ ref: media.ref, kind: media.kind, name: media.name ?? media.ref }), media.kind);
      ({ duration_ms: durationMs, width, height } = probed);
    }
    placeAsset({ id: newId("a"), kind: media.kind, ref: media.ref, name: (media.name ?? media.ref).slice(0, 200), duration_ms: durationMs, width, height }, true, at);
  }

  function applyStyle(style: { look: LookId } | { transition: TransitionId }, clipId: string, at?: number) {
    const current = stateRef.current.timeline;
    if ("look" in style) {
      if (!takesLook(current, clipId)) return setMessage(t("lookNeedsPicture"));
      edit(applyLook(current, clipId, style.look, effectsOffered(config)), clipId);
    } else edit(applyTransition(current, clipId, style.transition, at), clipId);
  }

  function addText(presetId: string, at: number) {
    const preset = config.text.presets.find((p) => p.id === presetId) ?? null;
    const r = addStyledTitle(stateRef.current.timeline, at, preset);
    edit(r.timeline, r.clipId);
  }

  // Dragging a title or picture on the preview moves it (and selects it). Snap on, it settles on the
  // centre lines when close to them, shown by guides.
  const stageDrag = useRef<{ id: string; px: number; py: number; k: number; x: number; y: number; before: Timeline; moved: boolean } | null>(null);
  function canvasPoint(event: { clientX: number; clientY: number }) {
    const el = canvas.current!;
    const r = el.getBoundingClientRect();
    const k = Math.min(r.width / el.width, r.height / el.height);
    return { x: (event.clientX - r.left - (r.width - el.width * k) / 2) / k, y: (event.clientY - r.top - (r.height - el.height * k) / 2) / k, k };
  }
  function stageDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || playing || !engine.current) return;
    const p = canvasPoint(event);
    const id = engine.current.clipAt(p.x, p.y);
    if (!id) return;
    const found = findClip(stateRef.current.timeline, id);
    if (!found || found.track.kind === "audio") return;
    dispatch({ type: "select", id });
    event.currentTarget.setPointerCapture(event.pointerId);
    stageDrag.current = { id, px: event.clientX, py: event.clientY, k: p.k, x: found.clip.x, y: found.clip.y, before: stateRef.current.timeline, moved: false };
  }
  function stageMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const d = stageDrag.current;
    const el = canvas.current;
    if (!el) return;
    if (!d) {
      if (!playing && engine.current) { const p = canvasPoint(event); el.style.cursor = engine.current.clipAt(p.x, p.y) ? "move" : ""; }
      return;
    }
    const dx = (event.clientX - d.px) / d.k;
    const dy = (event.clientY - d.py) / d.k;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    let x = Math.max(-1, Math.min(1, d.x + (dx * 2) / el.width));
    let y = Math.max(-1, Math.min(1, d.y + (dy * 2) / el.height));
    const near = 0.03;
    const v = snapping && Math.abs(x) < near;
    const h = snapping && Math.abs(y) < near;
    if (v) x = 0;
    if (h) y = 0;
    setGuides({ v, h });
    live(updateClip(d.before, d.id, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }));
  }
  function stageUp() {
    const d = stageDrag.current;
    stageDrag.current = null;
    setGuides(null);
    if (d?.moved) commit(d.before);
  }

  function dropped(payload: DragPayload, place: { trackId: string; at: number; clipId: string | null }) {
    setReview(null);
    if ("text" in payload) {
      const preset = config.text.presets.find((p) => p.id === payload.text);
      const current = stateRef.current.timeline;
      const onTitle = place.clipId ? findClip(current, place.clipId) : null;
      if (preset && onTitle?.clip.text) return edit(applyTextPreset(current, onTitle.clip.id, preset), onTitle.clip.id);
      return addText(payload.text, place.at);
    }
    if ("asset" in payload) {
      const placed = placeClip(stateRef.current.timeline, payload.asset, place.at, addModeRef.current, place);
      if (placed) edit(placed.timeline, placed.clipId);
    } else if ("media" in payload) void addMedia(payload.media, place);
    else if (place.clipId) applyStyle(payload, place.clipId, place.at);
    else setMessage(t("dropOntoClip"));
  }

  function split() {
    const at = (c: { start_ms: number; duration_ms: number }) => time > c.start_ms && time < c.start_ms + c.duration_ms;
    const target = selection && at(selection.clip) ? selection.clip.id : timeline.tracks.flatMap((tr) => tr.clips).find(at)?.id;
    if (!target) return setMessage(t("moveOntoClip"));
    const cut = splitClip(timeline, target, time);
    if (!cut) return setMessage(t("moveAwayFromEdge"));
    setMessage(null);
    edit(cut.timeline, cut.clipId);
  }

  const usedAssets = useMemo(() => new Set(timeline.tracks.flatMap((tr) => tr.clips.map((c) => c.asset_id).filter((x): x is string => !!x))), [timeline]);

  const togglePlay = useCallback(async () => {
    const e = engine.current;
    if (!e) return;
    if (e.isPlaying) { e.pause(); setPlaying(false); } else { setReview(null); setPlaying(true); await e.play(time); }
  }, [time]);
  const seek = useCallback((ms: number) => {
    setPlaying(false);
    void engine.current?.seek(Math.max(0, Math.min(ms, config.limits.maxDurationMs, MAX_DURATION_MS)));
  }, [config.limits.maxDurationMs]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === " " && target?.tagName !== "BUTTON" && f.preview) {
        event.preventDefault();
        void togglePlay();
      } else if (f.history && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if (f.history && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
    }
    // only when focus is inside this editor
    const root = document.getElementById(`${uid}-root`);
    root?.addEventListener("keydown", onKey);
    return () => root?.removeEventListener("keydown", onKey);
  }, [togglePlay, f.history, f.preview, uid]);

  const btn = cx("button", "ve-button");
  const btn2 = cx("buttonSecondary", "ve-button ve-button--secondary");
  const field = cx("field", "ve-field");
  const input = cx("input", "ve-input");
  const canExport = f.export && !!adapter.uploadExport;
  const saveText = saving === "saved" ? t("saved") : saving === "saving" ? t("saving") : saving === "error" ? t("saveFailed") : t("unsaved");

  if (!capable.ok) return <div className="ve-root"><p className={cx("alert", "ve-alert")} role="alert">{t("unsupportedBrowser")}</p></div>;

  return (
    <div id={`${uid}-root`} className={cx("root", `ve-root ${className ?? ""}`)} data-layout={config.layout}>
      {header}
      {/* The top bar: the title, the picture settings in a popover, undo/redo, saving and export. One slim row. */}
      <div className={cx("panel", "ve-topbar")} role="toolbar" aria-label={t("projectBar")}>
        {barStart ? <div className="ve-topbar__start">{barStart}</div> : null}
        {f.projectBar ? (
          <input id={`${uid}-title`} className={`${input} ve-topbar__title`} aria-label={t("projectTitle")} value={title} maxLength={300}
            onChange={(e) => { setTitle(e.target.value); metaRevision.current += 1; }} />
        ) : <span className="ve-topbar__title ve-topbar__title--static">{title}</span>}
        {f.projectBar ? (
          <div className="ve-topbar__group">
            <button type="button" className={btn2} aria-expanded={settingsOpen} aria-controls={`${uid}-settings`} onClick={() => setSettingsOpen((o) => !o)}>
              <span className="ve-topbar__meta">{`${size.width} × ${size.height} · ${size.fps} ${t("fps")}`}</span>
            </button>
            {settingsOpen ? (
              <div id={`${uid}-settings`} className="ve-popover" role="dialog" aria-label={t("videoSettings")}
                onKeyDown={(e) => { if (e.key === "Escape") setSettingsOpen(false); }}>
                {config.canvas.sizes.length > 0 ? (
                  <div className={field}>
                    <label htmlFor={`${uid}-size`}>{t("pictureSize")}</label>
                    <select id={`${uid}-size`} className={input} value={sizeId(size.width, size.height, config.canvas.sizes)} onChange={(e) => { const s = config.canvas.sizes.find((x) => x.id === e.target.value); if (s) { setSize((p) => ({ ...p, width: s.width, height: s.height })); metaRevision.current += 1; } }}>
                      {sizeId(size.width, size.height, config.canvas.sizes) === "custom" ? <option value="custom">{size.width} × {size.height}</option> : null}
                      {config.canvas.sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                ) : null}
                {config.canvas.fpsChoices.length > 0 ? (
                  <div className={field}>
                    <label htmlFor={`${uid}-fps`}>{t("framesPerSecond")}</label>
                    <select id={`${uid}-fps`} className={input} value={size.fps} onChange={(e) => { setSize((p) => ({ ...p, fps: Number(e.target.value) })); metaRevision.current += 1; }}>
                      {config.canvas.fpsChoices.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ) : null}
                <button type="button" className={btn2} onClick={() => setSettingsOpen(false)}>{t("close")}</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {f.history ? (
          <div className="ve-topbar__group" role="group" aria-label={t("history")}>
            <button type="button" className={btn2} onClick={() => dispatch({ type: "undo" })} disabled={state.past.length === 0}>{t("undo")}</button>
            <button type="button" className={btn2} onClick={() => dispatch({ type: "redo" })} disabled={state.future.length === 0}>{t("redo")}</button>
          </div>
        ) : null}
        {canSave ? (
          <p className="ve-muted ve-topbar__save" role="status" aria-live="polite">
            {saveText}{" "}
            {saving === "error" || saving === "dirty" ? <button type="button" className={btn2} onClick={() => void save()}>{t("saveNow")}</button> : null}
          </p>
        ) : null}
        {canExport ? <button type="button" className={`${btn} ve-topbar__export`} aria-expanded={exportOpen} aria-controls={`${uid}-export`} onClick={() => setExportOpen(true)}>{t("export")}</button> : null}
      </div>

      {message ? <p className={cx("alert", "ve-alert")} role="alert">{message}</p> : null}

      <div className="ve-work" data-media={f.mediaPanel} data-inspector={f.inspector}>
        {f.mediaPanel ? <MediaPanel timeline={timeline} onAsset={placeAsset} onAddMedia={(m) => void addMedia(m)} libraryKey={libraryKey}
          selection={selection ? { clipId: selection.clip.id, kind: selection.track.kind } : null} onStyle={(style, id) => applyStyle(style, id)} onAddText={(id) => addText(id, time)} onAddToTimeline={(id) => { const p = placeClip(timeline, id, time, addMode); if (p) edit(p.timeline, p.clipId); }}
          addMode={addMode} onAddMode={setAddMode} onReview={(m) => { if (playing) void togglePlay(); setReview(m); }} onRemoveAsset={(id) => edit({ ...timeline, assets: timeline.assets.filter((a) => a.id !== id) })} usedAssets={usedAssets} onError={setMessage} /> : null}

        <section className={cx("panel", "ve-panel ve-stage")} aria-labelledby={`${uid}-preview`} hidden={!f.preview}>
          <h2 id={`${uid}-preview`} className="ve-visually-hidden">{t("preview")}</h2>
          {review ? (
            <div className="ve-review" role="group" aria-label={t("reviewing", { name: review.name ?? review.ref })}>
              <p className="ve-review__name">{t("reviewing", { name: review.name ?? review.ref })}</p>
              <button type="button" className={btn} onClick={() => { void addMedia(review); setReview(null); }}>{t("addToTimeline")}</button>
              <button type="button" className={btn2} onClick={() => setReview(null)}>{t("backToTimeline")}</button>
            </div>
          ) : null}
          <div className="ve-stage__screen" data-reviewing={review ? true : undefined} onKeyDown={(e) => { if (review && e.key === "Escape") setReview(null); }}>
            {review ? <Review media={review} url={review.url ?? adapter.mediaUrl({ ref: review.ref, kind: review.kind, name: review.name ?? review.ref })} /> : null}
            <canvas ref={canvas} className="ve-stage__canvas" width={size.width} height={size.height} role="img" aria-label={t("previewAt", { time: formatTime(time) })}
              onPointerDown={stageDown} onPointerMove={stageMove} onPointerUp={stageUp} onPointerCancel={stageUp} />
            {guides?.v ? <span className="ve-guide ve-guide--v" aria-hidden="true" /> : null}
            {guides?.h ? <span className="ve-guide ve-guide--h" aria-hidden="true" /> : null}
          </div>
          <div className="ve-transport" role="group" aria-label={t("playback")} hidden={!!review}>
            <button type="button" className={`${btn2} ve-icon-button`} onClick={() => seek(0)} aria-label={t("toStart")} title={t("toStart")}><Icon d="M6 5v14M18 6l-9 6 9 6z" /></button>
            <button type="button" className={`${btn2} ve-icon-button`} onClick={() => seek(time - 1000)} aria-label={t("back1")} title={t("back1")}><Icon d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" /></button>
            <button type="button" className={`${btn} ve-transport__play`} onClick={() => void togglePlay()} aria-pressed={playing} disabled={duration === 0}>{playing ? t("pause") : t("play")}</button>
            <button type="button" className={`${btn2} ve-icon-button`} onClick={() => seek(time + 1000)} aria-label={t("forward1")} title={t("forward1")}><Icon d="M13 6l7 6-7 6zM4 6l7 6-7 6z" /></button>
            <label htmlFor={`${uid}-pos`} className="ve-visually-hidden">{t("position")}</label>
            <input id={`${uid}-pos`} className={`${input} ve-transport__position`} type="range" min={0} max={Math.max(duration, 1000)} step={100} value={Math.min(time, Math.max(duration, 1000))} aria-valuetext={formatTime(time)} onChange={(e) => seek(Number(e.target.value))} />
            <span className="ve-transport__time">{formatTime(time)} / {formatTime(duration)}</span>
          </div>
        </section>

        {f.inspector ? (
          selection ? <Inspector key={selection.clip.id} timeline={timeline} track={selection.track} clip={selection.clip} playhead={time} onChange={(next, o) => (o?.live ? live(next) : edit(next))} onCommit={() => commit()} />
          : <section className={cx("panel", "ve-panel ve-inspector")}><h2 className={cx("heading", "ve-heading")}>{t("clipSettings")}</h2><p className="ve-muted">{t("selectAClip")}</p></section>
        ) : null}

        <section className={cx("panel", "ve-panel ve-tl")} aria-labelledby={`${uid}-tl`}>
          <div className={cx("actions", "ve-actions ve-tl__tools")} role="toolbar" aria-label={t("editingTools")}>
            <h2 id={`${uid}-tl`} className={cx("heading", "ve-heading ve-tl__heading")}>{t("timeline")}</h2>
            {f.split ? <button type="button" className={btn2} onClick={split} title={t("splitHelp")}>{t("split")}</button> : null}
            <button type="button" className={btn2} disabled={!selection} title={t("deleteClipHelp")} onClick={() => selection && edit(removeClip(timeline, selection.clip.id), null)}>{t("deleteClip")}</button>
            {f.arrange ? <>
              <button type="button" className={btn2} disabled={!selection} title={t("deleteCloseHelp")} onClick={() => selection && edit(rippleRemove(timeline, selection.clip.id), null)}>{t("deleteClose")}</button>
              <button type="button" className={btn2} disabled={!selection} onClick={() => { const d = selection && duplicateClip(timeline, selection.clip.id); if (d) edit(d.timeline, d.clipId); }}>{t("duplicate")}</button>
              <button type="button" className={btn2} disabled={!selection} title={t("closeGapsHelp")} onClick={() => selection && edit(closeGaps(timeline, selection.track.id))}>{t("closeGaps")}</button>
            </> : null}
            {f.titles ? <button type="button" className={btn2} onClick={() => { const r = addTitle(timeline, time, t("defaultTitleText")); edit(r.timeline, r.clipId); }}>{t("addTitle")}</button> : null}
            {f.tracks && timeline.tracks.length < config.limits.maxTracks ? <>
              <button type="button" className={btn2} title={t("addVideoTrackHelp")} onClick={() => edit(addTrack(timeline, "video"))}>{t("addVideoTrack")}</button>
              <button type="button" className={btn2} title={t("addAudioTrackHelp")} onClick={() => edit(addTrack(timeline, "audio"))}>{t("addAudioTrack")}</button>
            </> : null}
            <button type="button" className={`${btn2} ve-snap`} aria-pressed={snapping} title={t("snapHelp")} onClick={() => setSnapping((v) => !v)}>
              {t("snap")}: {snapping ? t("on") : t("off")}
            </button>
            {f.zoom ? (
              <div className={`${field} ve-zoom`}>
                <label htmlFor={`${uid}-zoom`}>{t("zoom")}</label>
                <input id={`${uid}-zoom`} className={input} type="range" min={10} max={300} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </div>
            ) : null}
            <details className="ve-tl__help">
              <summary>{t("howToEdit")}</summary>
              <p className="ve-hint">{t("timelineHelp")}</p>
            </details>
          </div>
          <TimelinePanel timeline={timeline} selected={selected} playhead={time} zoom={zoom} onSelect={(id) => dispatch({ type: "select", id })} onSeek={seek} onLive={live} onCommit={commit} onEdit={edit} onDrop={dropped} snapping={snapping} addMode={addMode} />
        </section>
      </div>

      {/* Export opens over the workspace; it stays mounted so a running export is never lost. */}
      {canExport ? (
        <div className="ve-sheet" hidden={!exportOpen} onKeyDown={(e) => { if (e.key === "Escape") setExportOpen(false); }}>
          <div id={`${uid}-export`} className="ve-sheet__panel" role="dialog" aria-modal="true" aria-label={t("makeVideo")}>
            <button type="button" className={`${btn2} ve-sheet__close`} onClick={() => setExportOpen(false)}>{t("close")}</button>
            <ExportPanel engine={engine} duration={duration} fps={size.fps} title={title} current={current} exported={exported} onExported={setExported} onSave={save} exportActions={exportActions} onBefore={() => engine.current?.isPlaying && engine.current.pause()} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExportPanel({ engine, duration, fps, title, current, exported, onExported, onSave, exportActions, onBefore }: {
  engine: React.RefObject<VideoEngine | null>; duration: number; fps: number; title: string; current: () => Project;
  exported: MediaRef | null; onExported: (m: MediaRef) => void; onSave: () => Promise<void>; exportActions?: VideoEditorProps["exportActions"]; onBefore: () => void;
}) {
  const { adapter, t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const [phase, setPhase] = useState<"idle" | "rendering" | "uploading">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    const e = engine.current;
    if (!e || !adapter.uploadExport) return;
    setError(null);
    setDone(false);
    onBefore();
    await onSave();
    abort.current = new AbortController();
    setPhase("rendering");
    setProgress(0);
    try {
      const rendered = await e.exportVideo(fps, setProgress, abort.current.signal);
      setPhase("uploading");
      setProgress(0);
      let bytes: Uint8Array = new Uint8Array(await rendered.blob.arrayBuffer());
      if (rendered.mimeType.includes("webm")) bytes = withDuration(bytes, rendered.durationMs);
      const ext = rendered.mimeType.includes("mp4") ? "mp4" : "webm";
      const name = `${(title.trim() || t("untitled")).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120)}.${ext}`;
      const file = new File([bytes.slice().buffer as ArrayBuffer], name, { type: rendered.blob.type });
      const project = current();
      const media = await adapter.uploadExport(file, setProgress, project);
      onExported(media);
      await adapter.onExported?.(media, project);
      setDone(true);
    } catch (err) {
      adapter.onError?.(err instanceof Error ? err : new Error(String(err)));
      setError(err instanceof Error && err.message ? err.message : t("exportFailed"));
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  return (
    <section className={cx("panel", "ve-panel")} aria-labelledby={`${uid}-h`} aria-busy={busy}>
      <h2 id={`${uid}-h`} className={cx("heading", "ve-heading")}>{t("makeVideo")}</h2>
      <p className="ve-muted">{t("makeVideoHelp")}</p>
      {error ? <p className={cx("alert", "ve-alert")} role="alert">{error}</p> : null}
      {done ? <p role="status">{t("videoReady")}</p> : null}
      {busy ? (
        <div role="status">
          <label htmlFor={`${uid}-p`}>{phase === "rendering" ? t("making") : t("savingVideo")} {Math.round(progress * 100)}%</label>
          <progress id={`${uid}-p`} max={100} value={Math.round(progress * 100)} />
        </div>
      ) : null}
      <div className={cx("actions", "ve-actions")}>
        <button type="button" className={cx("button", "ve-button")} onClick={() => void run()} disabled={busy || duration === 0}>{exported ? t("makeVideoAgain") : t("makeVideo")}</button>
        {phase === "rendering" ? <button type="button" className={cx("buttonSecondary", "ve-button ve-button--secondary")} onClick={() => abort.current?.abort()}>{t("cancel")}</button> : null}
      </div>
      {duration === 0 ? <p className="ve-hint">{t("addSomething")}</p> : null}
      {exported ? (
        <div className="ve-finished">
          <h3 className={cx("heading", "ve-heading")}>{t("yourVideo")}</h3>
          <video controls preload="metadata" src={exported.url ?? adapter.mediaUrl({ ref: exported.ref, kind: "video", name: exported.name ?? "" })} className="ve-finished__player" />
          {exportActions ? exportActions(exported, current()) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A small line drawing for an icon-only button (the button carries the words as its label). */
function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

