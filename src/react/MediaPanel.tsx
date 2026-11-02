import { useEffect, useId, useRef, useState } from "react";
import { Recorder, captureProblemKey, captureSupported, openCapture, probeMedia, recordingName, type Capture, type CaptureMode } from "../core/capture";
import { recordModes, uploadAccept, uploadKinds } from "../core/config";
import { classifyFile, formatTime, newId, type Asset, type AssetKind, type Timeline } from "../core/timeline";
import { useCx, useEditor } from "./context";

interface Props {
  timeline: Timeline;
  onAsset: (asset: Asset, addToTimeline: boolean) => void;
  onAddToTimeline: (assetId: string) => void;
  onRemoveAsset: (assetId: string) => void;
  usedAssets: ReadonlySet<string>;
  onError: (message: string | null) => void;
}

type Phase = "idle" | "preparing" | "ready" | "recording" | "paused" | "saving";
const KIND_KEY = { video: "kindVideo", audio: "kindAudio", image: "kindImage" } as const;

function megabytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** The project's media: upload, pick from the host's library, and record. Which of these appear is configuration. */
export function MediaPanel({ timeline, onAsset, onAddToTimeline, onRemoveAsset, usedAssets, onError }: Props) {
  const { config, adapter, t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const canStore = !!adapter.uploadMedia;
  const kinds = uploadKinds(config);
  const modes = canStore ? recordModes(config) : [];

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
    for (const file of Array.from(files ?? [])) {
      const kind = classifyFile(file.type);
      if (!kind || !kinds.includes(kind)) {
        onError(t("unsupportedFile", { name: file.name }));
        continue;
      }
      await add(file, kind);
    }
  }

  async function fromLibrary() {
    if (!adapter.pickMedia) return;
    const picked = await adapter.pickMedia(kinds);
    for (const media of picked) onAsset({ id: newId("a"), kind: media.kind, ref: media.ref, name: media.name ?? media.ref, duration_ms: media.durationMs ?? 0, width: 0, height: 0 }, false);
  }

  return (
    <section className={cx("panel", "ve-panel ve-media")} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className={cx("heading", "ve-heading")}>
        {t("media")}
      </h2>
      {canStore && kinds.length > 0 ? (
        <div className={cx("field", "ve-field")}>
          <label htmlFor={`${uid}-file`}>{t("uploadMedia")}</label>
          <input id={`${uid}-file`} className={cx("input", "ve-input")} type="file" accept={uploadAccept(config)} multiple disabled={!!busy} onChange={(e) => { void chosen(e.target.files); e.target.value = ""; }} />
        </div>
      ) : null}
      {config.features.library && adapter.pickMedia ? (
        <div className={cx("actions", "ve-actions")}>
          <button type="button" className={cx("buttonSecondary", "ve-button ve-button--secondary")} onClick={() => void fromLibrary()}>
            {t("chooseFromLibrary")}
          </button>
        </div>
      ) : null}
      {busy ? (
        <div role="status">
          <label htmlFor={`${uid}-progress`}>
            {busy} {Math.round(progress * 100)}%
          </label>
          <progress id={`${uid}-progress`} max={100} value={Math.round(progress * 100)} />
        </div>
      ) : null}
      {modes.length > 0 ? <RecordPanel modes={modes} disabled={!!busy} onRecorded={(file, kind, ms) => add(file, kind, { durationMs: ms }, true)} onError={onError} /> : null}
      <h3 className={cx("heading", "ve-heading")}>{t("inThisProject")}</h3>
      {timeline.assets.length === 0 ? (
        <p className="ve-muted">{t("nothingYet")}</p>
      ) : (
        <ul className="ve-assets">
          {timeline.assets.map((asset) => (
            <li key={asset.id}>
              <span className="ve-assets__name">{asset.name}</span>{" "}
              <span className="ve-muted">
                {t(KIND_KEY[asset.kind])}
                {asset.duration_ms ? `, ${formatTime(asset.duration_ms)}` : ""}
              </span>
              <div className={cx("actions", "ve-actions")}>
                <button type="button" className={cx("buttonSecondary", "ve-button ve-button--secondary")} onClick={() => onAddToTimeline(asset.id)}>
                  {t("addToTimeline")}
                  <span className="ve-visually-hidden">: {asset.name}</span>
                </button>
                <button type="button" className={cx("buttonSecondary", "ve-button ve-button--secondary")} disabled={usedAssets.has(asset.id)} title={usedAssets.has(asset.id) ? t("removeClipsFirst") : undefined} onClick={() => onRemoveAsset(asset.id)}>
                  <span aria-hidden="true">{t("removeAsset")}</span>
                  <span className="ve-visually-hidden">{t("removeAssetFrom", { name: asset.name })}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    // Folded by default: in the workspace the media column has a fixed height, and recording is
    // used less often than adding files. Its state is kept while folded.
    <details className="ve-record">
      <summary>{t("recordFromComputer")}</summary>
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
    </details>
  );
}
