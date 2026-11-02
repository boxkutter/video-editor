import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { EditorAdapter, MediaRef, Project } from "../core/adapter";
import { resolveConfig, type EditorOptions } from "../core/config";
import { VideoEngine, supportsEditing } from "../core/engine";
import { createT, type LabelOverrides } from "../core/labels";
import { initialState, reduce, sizeId } from "../core/state";
import { MAX_DURATION_MS, addAsset, addAssetClip, addTitle, addTrack, closeGaps, duplicateClip, emptyTimeline, findClip, formatTime, removeClip, rippleRemove, splitClip, timelineEnd, type Asset, type Timeline } from "../core/timeline";
import { withDuration } from "../core/webm";
import { EditorProvider, useCx, useEditor, type ClassNames } from "./context";
import { Inspector } from "./Inspector";
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

function Editor({ project, existingExport, exportActions, header, className, handleRef }: VideoEditorProps & { handleRef: React.Ref<VideoEditorHandle> }) {
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

  function placeAsset(asset: Asset, addToTimeline: boolean) {
    if (timeline.assets.length >= config.limits.maxAssets) return setMessage(t("fileRefused", { name: asset.name }));
    let next = addAsset(timeline, asset);
    let select: string | null | undefined;
    if (addToTimeline) {
      const placed = addAssetClip(next, asset.id, asset.kind === "audio" ? time : 0);
      if (placed) { next = placed.timeline; select = placed.clipId; }
    }
    edit(next, select);
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
    if (e.isPlaying) { e.pause(); setPlaying(false); } else { setPlaying(true); await e.play(time); }
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
    <div id={`${uid}-root`} className={cx("root", `ve-root ${className ?? ""}`)}>
      {header}
      {f.projectBar ? (
        <div className={cx("panel", "ve-panel ve-bar")}>
          <div className={`${field} ve-bar__title`}>
            <label htmlFor={`${uid}-title`}>{t("projectTitle")}</label>
            <input id={`${uid}-title`} className={input} value={title} maxLength={300} onChange={(e) => { setTitle(e.target.value); metaRevision.current += 1; }} />
          </div>
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
          {canSave ? (
            <p className="ve-muted ve-bar__save" role="status" aria-live="polite">
              {saveText}{" "}
              {saving === "error" || saving === "dirty" ? <button type="button" className={btn2} onClick={() => void save()}>{t("saveNow")}</button> : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? <p className={cx("alert", "ve-alert")} role="alert">{message}</p> : null}

      <div className="ve-main" data-media={f.mediaPanel} data-inspector={f.inspector}>
        {f.mediaPanel ? <MediaPanel timeline={timeline} onAsset={placeAsset} onAddToTimeline={(id) => { const p = addAssetClip(timeline, id, time); if (p) edit(p.timeline, p.clipId); }} onRemoveAsset={(id) => edit({ ...timeline, assets: timeline.assets.filter((a) => a.id !== id) })} usedAssets={usedAssets} onError={setMessage} /> : null}

        <section className={cx("panel", "ve-panel ve-stage")} aria-labelledby={`${uid}-preview`} hidden={!f.preview}>
          <h2 id={`${uid}-preview`} className={cx("heading", "ve-heading")}>{t("preview")}</h2>
          <canvas ref={canvas} className="ve-stage__canvas" width={size.width} height={size.height} role="img" aria-label={t("previewAt", { time: formatTime(time) })} />
          <div className="ve-transport" role="group" aria-label={t("playback")}>
            <button type="button" className={btn2} onClick={() => seek(0)}>{t("toStart")}</button>
            <button type="button" className={btn2} onClick={() => seek(time - 1000)}>{t("back1")}</button>
            <button type="button" className={btn} onClick={() => void togglePlay()} aria-pressed={playing} disabled={duration === 0}>{playing ? t("pause") : t("play")}</button>
            <button type="button" className={btn2} onClick={() => seek(time + 1000)}>{t("forward1")}</button>
            <span className="ve-transport__time">{formatTime(time)} / {formatTime(duration)}</span>
          </div>
          <div className={field}>
            <label htmlFor={`${uid}-pos`}>{t("position")}</label>
            <input id={`${uid}-pos`} className={input} type="range" min={0} max={Math.max(duration, 1000)} step={100} value={Math.min(time, Math.max(duration, 1000))} aria-valuetext={formatTime(time)} onChange={(e) => seek(Number(e.target.value))} />
          </div>
        </section>

        {f.inspector ? (
          selection ? <Inspector key={selection.clip.id} timeline={timeline} track={selection.track} clip={selection.clip} playhead={time} onChange={(next, o) => (o?.live ? live(next) : edit(next))} onCommit={() => commit()} />
          : <section className={cx("panel", "ve-panel ve-inspector")}><h2 className={cx("heading", "ve-heading")}>{t("clipSettings")}</h2><p className="ve-muted">{t("selectAClip")}</p></section>
        ) : null}
      </div>

      <section className={cx("panel", "ve-panel")} aria-labelledby={`${uid}-tl`}>
        <h2 id={`${uid}-tl`} className={cx("heading", "ve-heading")}>{t("timeline")}</h2>
        <div className={cx("actions", "ve-actions")} role="toolbar" aria-label={t("editingTools")}>
          {f.history ? <>
            <button type="button" className={btn2} onClick={() => dispatch({ type: "undo" })} disabled={state.past.length === 0}>{t("undo")}</button>
            <button type="button" className={btn2} onClick={() => dispatch({ type: "redo" })} disabled={state.future.length === 0}>{t("redo")}</button>
          </> : null}
          {f.split ? <button type="button" className={btn2} onClick={split}>{t("split")}</button> : null}
          <button type="button" className={btn2} disabled={!selection} onClick={() => selection && edit(removeClip(timeline, selection.clip.id), null)}>{t("deleteClip")}</button>
          {f.arrange ? <>
            <button type="button" className={btn2} disabled={!selection} onClick={() => selection && edit(rippleRemove(timeline, selection.clip.id), null)}>{t("deleteClose")}</button>
            <button type="button" className={btn2} disabled={!selection} onClick={() => { const d = selection && duplicateClip(timeline, selection.clip.id); if (d) edit(d.timeline, d.clipId); }}>{t("duplicate")}</button>
            <button type="button" className={btn2} disabled={!selection} onClick={() => selection && edit(closeGaps(timeline, selection.track.id))}>{t("closeGaps")}</button>
          </> : null}
          {f.titles ? <button type="button" className={btn2} onClick={() => { const r = addTitle(timeline, time, t("defaultTitleText")); edit(r.timeline, r.clipId); }}>{t("addTitle")}</button> : null}
          {f.tracks && timeline.tracks.length < config.limits.maxTracks ? <>
            <button type="button" className={btn2} onClick={() => edit(addTrack(timeline, "video"))}>{t("addVideoTrack")}</button>
            <button type="button" className={btn2} onClick={() => edit(addTrack(timeline, "audio"))}>{t("addAudioTrack")}</button>
          </> : null}
          {f.zoom ? (
            <div className={`${field} ve-zoom`}>
              <label htmlFor={`${uid}-zoom`}>{t("zoom")}</label>
              <input id={`${uid}-zoom`} className={input} type="range" min={10} max={300} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </div>
          ) : null}
        </div>
        <TimelinePanel timeline={timeline} selected={selected} playhead={time} zoom={zoom} onSelect={(id) => dispatch({ type: "select", id })} onSeek={seek} onLive={live} onCommit={commit} onEdit={edit} />
        <p className="ve-hint">{t("timelineHelp")}</p>
      </section>

      {canExport ? <ExportPanel engine={engine} duration={duration} fps={size.fps} title={title} current={current} exported={exported} onExported={setExported} onSave={save} exportActions={exportActions} onBefore={() => engine.current?.isPlaying && engine.current.pause()} /> : null}
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
