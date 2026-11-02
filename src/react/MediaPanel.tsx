import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { LibraryItem, MediaRef } from "../core/adapter";
import { Recorder, captureProblemKey, captureSupported, openCapture, probeMedia, recordingName, type Capture, type CaptureMode } from "../core/capture";
import { effectsOffered, recordModes, uploadAccept, uploadKinds } from "../core/config";
import { LOOKS, TRANSITIONS, type LookId, type TransitionId } from "../core/styles";
import { previewCss } from "../core/text";
import { classifyFile, filterString, formatTime, newId, type Asset, type AssetKind, type Effect, type Timeline, type TrackKind } from "../core/timeline";
import { useCx, useEditor } from "./context";
import { setDrag } from "./drag";

interface Props {
  timeline: Timeline;
  onAsset: (asset: Asset, addToTimeline: boolean) => void;
  /** Add a library file to the project and put it on the timeline at the playhead. */
  onAddMedia: (media: MediaRef) => void;
  onAddToTimeline: (assetId: string) => void;
  onRemoveAsset: (assetId: string) => void;
  usedAssets: ReadonlySet<string>;
  onError: (message: string | null) => void;
  /** The library is listed again when this changes. */
  libraryKey?: unknown;
  /** The selected clip, which a look or transition chosen (not dragged) applies to. */
  selection: { clipId: string; kind: TrackKind } | null;
  onStyle: (style: { look: LookId } | { transition: TransitionId }, clipId: string) => void;
  /** Add a title in a text style at the playhead. */
  onAddText: (presetId: string) => void;
  /** Show a file in the preview, to look at or listen to before using it. */
  onReview: (media: MediaRef) => void;
}

type Phase = "idle" | "preparing" | "ready" | "recording" | "paused" | "saving";
type Tab = "project" | "library" | "upload" | "record" | "text" | "effects";
const KIND_KEY = { video: "kindVideo", audio: "kindAudio", image: "kindImage" } as const;

function megabytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * The project's media, on tabs: what is in the project, the host's library (shown in place, so its
 * files can be dragged onto the timeline), upload, and record. Which tabs appear is configuration.
 */
export function MediaPanel({ timeline, onAsset, onAddMedia, onAddToTimeline, onRemoveAsset, usedAssets, onError, libraryKey, selection, onStyle, onAddText, onReview }: Props) {
  const { config, adapter, t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dropping, setDropping] = useState(false);
  const canStore = !!adapter.uploadMedia;
  const kinds = uploadKinds(config);
  const modes = canStore ? recordModes(config) : [];
  const hasLibrary = config.features.library && !!(adapter.listMedia || adapter.pickMedia);
  const looks = effectsOffered(config).length > 0;
  const fades = config.features.fades;
  const tabs: Tab[] = ["project", ...(hasLibrary ? (["library"] as const) : []), ...(canStore && kinds.length > 0 ? (["upload"] as const) : []), ...(modes.length > 0 ? (["record"] as const) : []), ...(config.features.titles && config.text.presets.length > 0 ? (["text"] as const) : []), ...(looks || fades ? (["effects"] as const) : [])];
  // An empty project opens on the library (or upload): there is nothing to show under Project yet.
  const [tab, setTab] = useState<Tab>(() => (timeline.assets.length === 0 ? (tabs[1] ?? "project") : "project"));
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabName: Record<Tab, string> = { project: t("tabProject"), library: t("tabLibrary"), upload: t("tabUpload"), record: t("tabRecord"), text: t("tabText"), effects: t("tabEffects") };

  async function add(file: File, kind: AssetKind, known?: { durationMs: number }, addToTimeline = false) {
    if (!adapter.uploadMedia) return;
    if (file.size > config.limits.maxUploadBytes) return onError(t("fileTooLarge", { name: file.name, limit: megabytes(config.limits.maxUploadBytes) }));
    setBusy(t("uploading", { name: file.name }));
    setProgress(0);
    try {
      const [probed, stored] = await Promise.all([probeMedia(file, kind), adapter.uploadMedia(file, kind, setProgress)]);
      onAsset({ id: newId("a"), kind, ref: stored.ref, name: (stored.name ?? file.name).slice(0, 200), duration_ms: known?.durationMs ?? stored.durationMs ?? probed.duration_ms, width: probed.width, height: probed.height }, addToTimeline);
    } catch (error) {
      adapter.onError?.(error instanceof Error ? error : new Error(String(error)));
      onError(error instanceof Error && error.message ? error.message : t("fileRefused", { name: file.name }));
    } finally {
      setBusy(null);
    }
  }

  async function chosen(files: FileList | null) {
    onError(null);
    const list = Array.from(files ?? []);
    for (const file of list) {
      const kind = classifyFile(file.type);
      if (!kind || !kinds.includes(kind)) {
        onError(t("unsupportedFile", { name: file.name }));
        continue;
      }
      await add(file, kind);
    }
    if (list.length > 0) setTab("project");
  }

  async function fromLibrary() {
    if (!adapter.pickMedia) return;
    const picked = await adapter.pickMedia(kinds);
    for (const media of picked) onAsset({ id: newId("a"), kind: media.kind, ref: media.ref, name: media.name ?? media.ref, duration_ms: media.durationMs ?? 0, width: 0, height: 0 }, false);
    if (picked.length > 0) setTab("project");
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const at = tabs.indexOf(tab);
    const to = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const btn2 = cx("buttonSecondary", "ve-button ve-button--secondary");
  const panel = (name: Tab) => ({ role: "tabpanel", id: `${uid}-${name}`, "aria-labelledby": `${uid}-${name}-tab`, hidden: tab !== name, className: "ve-media__panel" }) as const;
  return (
    <section className={cx("panel", "ve-panel ve-media")} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className={cx("heading", "ve-heading ve-visually-hidden")}>
        {t("media")}
      </h2>
      {tabs.length > 1 ? (
        <div className="ve-tabs" role="tablist" aria-label={t("mediaTabs")}>
          {tabs.map((name) => (
            <button key={name} ref={(el) => { tabRefs.current[name] = el; }} type="button" role="tab" id={`${uid}-${name}-tab`} className="ve-tab"
              aria-selected={tab === name} aria-controls={`${uid}-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={tabKey}>
              {tabName[name]}
              {name === "project" && timeline.assets.length > 0 ? <span className="ve-tab__count">{timeline.assets.length}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {busy ? (
        <div role="status" className="ve-media__busy">
          <label htmlFor={`${uid}-progress`}>
            {busy} {Math.round(progress * 100)}%
          </label>
          <progress id={`${uid}-progress`} max={100} value={Math.round(progress * 100)} />
        </div>
      ) : null}

      <div {...panel("project")}>
        {timeline.assets.length === 0 ? (
          <p className="ve-muted">{t("nothingYet")}</p>
        ) : (
          <ul className="ve-assets">
            {timeline.assets.map((asset) => (
              <li key={asset.id} draggable onDragStart={(e) => setDrag(e, { asset: asset.id }, asset.name)} className="ve-assets__item">
                <button type="button" className="ve-assets__name ve-linkish" onClick={() => onReview({ ref: asset.ref, kind: asset.kind, name: asset.name, durationMs: asset.duration_ms })}
                  title={t("reviewThis")}>{asset.name}</button>{" "}
                <span className="ve-muted">
                  {t(KIND_KEY[asset.kind])}
                  {asset.duration_ms ? `, ${formatTime(asset.duration_ms)}` : ""}
                </span>
                <div className={cx("actions", "ve-actions")}>
                  <button type="button" className={btn2} onClick={() => onAddToTimeline(asset.id)}>
                    {t("addToTimeline")}
                    <span className="ve-visually-hidden">: {asset.name}</span>
                  </button>
                  <button type="button" className={btn2} disabled={usedAssets.has(asset.id)} title={usedAssets.has(asset.id) ? t("removeClipsFirst") : undefined} onClick={() => onRemoveAsset(asset.id)}>
                    <span aria-hidden="true">{t("removeAsset")}</span>
                    <span className="ve-visually-hidden">{t("removeAssetFrom", { name: asset.name })}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasLibrary ? (
        <div {...panel("library")}>
          {adapter.listMedia ? (
            <Library kinds={kinds} shown={tab === "library"} libraryKey={libraryKey} inProject={new Set(timeline.assets.map((a) => `${a.kind}:${a.ref}`))} onAdd={onAddMedia} onReview={onReview} />
          ) : (
            <div className={cx("actions", "ve-actions")}>
              <button type="button" className={btn2} onClick={() => void fromLibrary()}>
                {t("chooseFromLibrary")}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {tabs.includes("upload") ? (
        <div {...panel("upload")}>
          <div className={cx("field", "ve-field")}>
            <label htmlFor={`${uid}-file`}>{t("uploadMedia")}</label>
            <input id={`${uid}-file`} className={cx("input", "ve-input")} type="file" accept={uploadAccept(config)} multiple disabled={!!busy} onChange={(e) => { void chosen(e.target.files); e.target.value = ""; }} />
          </div>
          <div className="ve-dropzone" data-active={dropping || undefined} aria-hidden="true"
            onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setDropping(true); } }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => { e.preventDefault(); setDropping(false); if (!busy) void chosen(e.dataTransfer.files); }}>
            {t("dropFiles")}
          </div>
        </div>
      ) : null}

      {tabs.includes("text") ? (
        <div {...panel("text")}>
          <TextStyles onAdd={onAddText} />
        </div>
      ) : null}

      {looks || fades ? (
        <div {...panel("effects")}>
          <Styles looks={looks} fades={fades} selection={selection} onStyle={onStyle} onError={onError} />
        </div>
      ) : null}

      {modes.length > 0 ? (
        <div {...panel("record")}>
          <RecordPanel modes={modes} disabled={!!busy} onRecorded={(file, kind, ms) => add(file, kind, { durationMs: ms }, true)} onError={onError} />
        </div>
      ) : null}
    </section>
  );
}

/** The text styles, as tiles drawn in their own font and colours. */
function TextStyles({ onAdd }: { onAdd: (presetId: string) => void }) {
  const { config, t } = useEditor();
  const familyOf = (id?: string) => (config.text.fonts.find((f) => f.id === id) ?? config.text.fonts[0])?.family ?? "";
  const groups = (["professional", "social", "fun"] as const).map((g) => ({ g, items: config.text.presets.filter((p) => p.group === g) })).filter((x) => x.items.length);
  return (
    <>
      <p className="ve-hint">{t("textHint")}</p>
      {groups.map(({ g, items }) => (
        <section key={g} className="ve-library__group" aria-label={t(`textGroup_${g}`)}>
          <h3 className="ve-library__heading">{t(`textGroup_${g}`)}</h3>
          <ul className="ve-library ve-library--text">
            {items.map((p) => (
              <li key={p.id}>
                <button type="button" className="ve-tile ve-tile--text" draggable onDragStart={(e) => setDrag(e, { text: p.id }, p.label)} onClick={() => onAdd(p.id)}
                  aria-label={t("addTextStyle", { name: p.label })} title={p.label}>
                  <span className="ve-tile__thumb ve-tile__textthumb" aria-hidden="true">
                    <span style={previewCss(p.style, familyOf(p.style.font))}>{p.label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

const TRANSITION_ICON: Record<TransitionId, string> = { fade_in: "◢", fade_out: "◣", fade_both: "◆", dip: "⧗" };

/** Looks and transitions: dragged onto a clip, or chosen for the selected clip. */
function Styles({ looks, fades, selection, onStyle, onError }: { looks: boolean; fades: boolean; selection: Props["selection"]; onStyle: Props["onStyle"]; onError: Props["onError"] }) {
  const { config, t } = useEditor();
  const offered = effectsOffered(config);
  function choose(style: { look: LookId } | { transition: TransitionId }) {
    if (!selection) return onError(t("selectClipFirst"));
    if ("look" in style && selection.kind !== "video") return onError(t("lookNeedsPicture"));
    onError(null);
    onStyle(style, selection.clipId);
  }
  const tile = (key: string, name: string, payload: { look: LookId } | { transition: TransitionId }, thumb: ReactNode) => (
    <li key={key}>
      <button type="button" className="ve-tile ve-tile--style" draggable onDragStart={(e) => setDrag(e, payload, name)} onClick={() => choose(payload)}
        aria-label={t("applyTo", { name })} title={name}>
        {thumb}
        <span className="ve-tile__name">{name}</span>
      </button>
    </li>
  );
  return (
    <>
      <p className="ve-hint">{t("effectsHint")}</p>
      {looks ? (
        <section className="ve-library__group" aria-label={t("looks")}>
          <h3 className="ve-library__heading">{t("looks")}</h3>
          <ul className="ve-library">
            {(Object.keys(LOOKS) as LookId[]).map((id) => {
              const effects = (LOOKS[id] as Effect[]).filter((e) => offered.includes(e.type));
              if (id !== "none" && effects.length === 0) return null;
              return tile(id, t(`look_${id}`), { look: id }, <span className="ve-tile__thumb ve-tile__look" style={{ filter: filterString(effects) }} aria-hidden="true" />);
            })}
          </ul>
        </section>
      ) : null}
      {fades ? (
        <section className="ve-library__group" aria-label={t("transitions")}>
          <h3 className="ve-library__heading">{t("transitions")}</h3>
          <ul className="ve-library">
            {TRANSITIONS.map((id) => tile(id, t(`transition_${id}`), { transition: id }, <span className="ve-tile__thumb ve-tile__fade" data-fade={id} aria-hidden="true">{TRANSITION_ICON[id]}</span>))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** The host's library, listed in place: tiles you can drag onto the timeline or choose to add at the playhead. */
function Library({ kinds, shown, libraryKey, inProject, onAdd, onReview }: { kinds: AssetKind[]; shown: boolean; libraryKey: unknown; inProject: ReadonlySet<string>; onAdd: (media: MediaRef) => void; onReview: (media: MediaRef) => void }) {
  const { adapter, t } = useEditor();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState<{ key: unknown } | null>(null);
  const kindsKey = kinds.join(",");

  // Listed the first time the tab is shown, and again when the host's key changes.
  useEffect(() => {
    if (!shown || !adapter.listMedia || (loadedFor && Object.is(loadedFor.key, libraryKey))) return;
    let cancelled = false;
    setFailed(false);
    adapter.listMedia(kindsKey.split(",") as AssetKind[]).then(
      (list) => { if (!cancelled) { setItems(list.filter((i) => kinds.includes(i.kind))); setLoadedFor({ key: libraryKey }); } },
      (error) => { if (!cancelled) { adapter.onError?.(error instanceof Error ? error : new Error(String(error))); setFailed(true); } },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kinds by value
  }, [shown, libraryKey, kindsKey, adapter]);

  if (failed) return <p className="ve-muted" role="alert">{t("libraryFailed")}</p>;
  if (items === null) return <p className="ve-muted" role="status">{t("libraryLoading")}</p>;
  if (items.length === 0) return <p className="ve-muted">{t("libraryEmpty")}</p>;
  const groups: { name: string; note?: string; items: LibraryItem[] }[] = [];
  for (const item of items) {
    const name = item.group ?? "";
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, note: item.groupNote, items: [] }));
    g.items.push(item);
  }
  return (
    <>
      <p className="ve-hint">{t("libraryHint")}</p>
      {groups.map((g) => (
        <section key={g.name} className="ve-library__group" aria-label={g.name || t("tabLibrary")}>
          {g.name ? <h3 className="ve-library__heading">{g.name}</h3> : null}
          {g.note ? <p className="ve-hint">{g.note}</p> : null}
          <ul className="ve-library">
            {g.items.map((item) => {
              const name = item.name ?? item.ref;
              const url = item.url ?? adapter.mediaUrl({ ref: item.ref, kind: item.kind, name });
              const media: MediaRef = { ref: item.ref, kind: item.kind, name, durationMs: item.durationMs, url: item.url };
              return (
                <li key={`${item.kind}:${item.ref}`} className="ve-tile-wrap">
                  <button type="button" className="ve-tile" draggable onDragStart={(e) => setDrag(e, { media }, name)} onClick={() => onReview(media)}
                    aria-label={t("reviewItem", { name })} title={`${name}: ${t("reviewHint")}`}>
                    <span className="ve-tile__thumb" data-kind={item.kind}>
                      {item.thumbnailUrl || item.kind === "image" ? <img src={item.thumbnailUrl ?? url} alt="" loading="lazy" draggable={false} />
                        : item.kind === "video" ? <video src={`${url}#t=0.5`} muted preload="metadata" tabIndex={-1} />
                        : <span aria-hidden="true" className="ve-tile__note">♪</span>}
                      {item.durationMs ? <span className="ve-tile__time">{formatTime(item.durationMs, false)}</span> : null}
                      {inProject.has(`${item.kind}:${item.ref}`) ? <span className="ve-tile__in" title={t("inProject")}>✓</span> : null}
                    </span>
                    <span className="ve-tile__name">{name}</span>
                  </button>
                  <button type="button" className="ve-tile__add" onClick={() => onAdd(media)} aria-label={t("addItemToTimeline", { name })} title={t("addItemToTimeline", { name })}>
                    <span aria-hidden="true">+</span> {t("addShort")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function RecordPanel({ modes, disabled, onRecorded, onError }: { modes: CaptureMode[]; disabled: boolean; onRecorded: (file: File, kind: "video" | "audio", durationMs: number) => Promise<void>; onError: (message: string | null) => void }) {
  const { t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const [mode, setMode] = useState<CaptureMode>(modes[0]!);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const preview = useRef<HTMLVideoElement>(null);
  const capture = useRef<Capture | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const names: Record<CaptureMode, string> = { camera: t("recordCamera"), screen: t("recordScreen"), microphone: t("recordMicrophone") };

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setElapsed(recorder.current?.elapsedMs() ?? 0), 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => () => { recorder.current?.cancel(); capture.current?.release(); }, []);

  async function prepare() {
    onError(null);
    setPhase("preparing");
    try {
      const opened = await openCapture(mode);
      capture.current = opened;
      opened.stream.getVideoTracks()[0]?.addEventListener("ended", () => void finish());
      if (preview.current) preview.current.srcObject = opened.stream;
      setPhase("ready");
    } catch (error) {
      onError(t(captureProblemKey(error)));
      setPhase("idle");
    }
  }

  function begin() {
    if (!capture.current) return;
    recorder.current = new Recorder(capture.current);
    recorder.current.start();
    setElapsed(0);
    setPhase("recording");
  }

  function togglePause() {
    const r = recorder.current;
    if (!r) return;
    if (r.state === "recording") { r.pause(); setPhase("paused"); } else { r.resume(); setPhase("recording"); }
  }

  async function finish() {
    const r = recorder.current;
    if (!r) { capture.current?.release(); capture.current = null; setPhase("idle"); return; }
    recorder.current = null;
    setPhase("saving");
    const result = await r.stop();
    capture.current = null;
    if (preview.current) preview.current.srcObject = null;
    if (result.blob.size === 0 || result.durationMs < 300) { onError(t("recordingEmpty")); setPhase("idle"); return; }
    await onRecorded(new File([result.blob], recordingName(mode, result.mimeType), { type: result.blob.type }), result.kind, Math.round(result.durationMs));
    setPhase("idle");
  }

  function discard() {
    recorder.current?.cancel(); recorder.current = null;
    capture.current?.release(); capture.current = null;
    if (preview.current) preview.current.srcObject = null;
    setPhase("idle");
  }

  const live = phase === "ready" || phase === "recording" || phase === "paused";
  const btn = cx("button", "ve-button");
  const btn2 = cx("buttonSecondary", "ve-button ve-button--secondary");
  return (
    // On its own tab; the tab is only hidden when you leave it, so a recording carries on.
    <div className="ve-record">
      <h3 className={cx("heading", "ve-heading")}>{t("recordFromComputer")}</h3>
      {phase === "idle" || phase === "preparing" ? (
        <>
          <div className={cx("field", "ve-field")}>
            <label htmlFor={`${uid}-mode`}>{t("whatToRecord")}</label>
            <select id={`${uid}-mode`} className={cx("input", "ve-input")} value={mode} onChange={(e) => setMode(e.target.value as CaptureMode)} disabled={disabled || phase === "preparing"}>
              {modes.map((m) => (
                <option key={m} value={m} disabled={!captureSupported(m)}>
                  {names[m]}
                </option>
              ))}
            </select>
            <span className="ve-hint">{t("permissionHint")}</span>
          </div>
          <button type="button" className={btn} onClick={() => void prepare()} disabled={disabled || phase === "preparing"}>
            {phase === "preparing" ? t("waitingPermission") : t("getReady")}
          </button>
        </>
      ) : null}
      <div hidden={!live && phase !== "saving"}>
        <video ref={preview} className="ve-record__preview" hidden={mode === "microphone"} muted autoPlay playsInline aria-label={t("livePreview")} />
        {mode === "microphone" ? <p className="ve-muted">{t("micOnly")}</p> : null}
      </div>
      {live ? (
        <div className={cx("actions", "ve-actions")}>
          {phase === "ready" ? (
            <>
              <button type="button" className={btn} onClick={begin}>{t("record")}</button>
              <button type="button" className={btn2} onClick={discard}>{t("cancel")}</button>
            </>
          ) : (
            <>
              <button type="button" className={btn} onClick={() => void finish()}>{t("stopAndSave")}</button>
              <button type="button" className={btn2} onClick={togglePause}>{phase === "paused" ? t("resume") : t("pause")}</button>
              <button type="button" className={btn2} onClick={discard}>{t("discard")}</button>
              <span role="timer" aria-live="off" className="ve-record__time">
                {t(phase === "paused" ? "pausedTime" : "recordingTime", { time: formatTime(elapsed, false) })}
              </span>
            </>
          )}
        </div>
      ) : null}
      {phase === "saving" ? <p role="status">{t("savingRecording")}</p> : null}
    </div>
  );
}
