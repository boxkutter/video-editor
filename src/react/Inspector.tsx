import { useId } from "react";
import { cropPresets, effectsOffered } from "../core/config";
import { cropToRatio } from "../core/state";
import { EFFECTS, MIN_CLIP_MS, alignClip, assetOf, clipEnd, moveClip, setEffect, setSpeed, trimEnd, trimStart, updateClip, type Clip, type Timeline, type Track } from "../core/timeline";
import { useCx, useEditor } from "./context";

interface Props {
  timeline: Timeline;
  track: Track;
  clip: Clip;
  playhead: number;
  onChange: (next: Timeline, opts?: { live?: boolean }) => void;
  onCommit: () => void;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const seconds = (ms: number) => Math.round(ms / 10) / 100;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The selected clip's settings. Every control is a labelled field, so nothing depends on dragging (WCAG 2.5.7). */
export function Inspector({ timeline, track, clip, playhead, onChange, onCommit }: Props) {
  const { config, t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const f = config.features;
  const asset = assetOf(timeline, clip);
  const hasPicture = track.kind === "video";
  const btn2 = cx("buttonSecondary", "ve-button ve-button--secondary");
  const acts = cx("actions", "ve-actions");
  const field = cx("field", "ve-field");
  const input = cx("input", "ve-input");
  const text = clip.text;

  const num = (label: string, value: number, apply: (n: number) => Timeline, opts: { min?: number; hint?: string } = {}) => {
    const id = `${uid}-n-${label.replace(/\W+/g, "-")}`;
    return (
      <div className={field}>
        <label htmlFor={id}>
          {label} ({t("seconds")})
        </label>
        <input id={id} className={input} type="number" inputMode="decimal" min={opts.min} step={0.1} value={Number.isFinite(value) ? value : 0} onChange={(e) => { if (e.target.value !== "") onChange(apply(Number(e.target.value))); }} />
        {opts.hint ? <span className="ve-hint">{opts.hint}</span> : null}
      </div>
    );
  };

  const range = (label: string, value: number, min: number, max: number, step: number, apply: (n: number) => Timeline, show: (n: number) => string = String) => {
    const id = `${uid}-r-${label.replace(/\W+/g, "-")}`;
    return (
      <div className={field} key={id}>
        <label htmlFor={id}>
          {label}: <output htmlFor={id}>{show(value)}</output>
        </label>
        <input id={id} className={input} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(apply(Number(e.target.value)), { live: true })} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
      </div>
    );
  };

  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const setCrop = (patch: Partial<typeof crop>) => {
    const next = { ...crop, ...patch };
    next.w = Math.min(Math.max(next.w, 0.05), 1);
    next.h = Math.min(Math.max(next.h, 0.05), 1);
    next.x = Math.min(Math.max(next.x, 0), 1 - next.w);
    next.y = Math.min(Math.max(next.y, 0), 1 - next.h);
    return updateClip(timeline, clip.id, { crop: next });
  };
  const setText = (patch: Partial<NonNullable<typeof text>>, live = false) => text && onChange(updateClip(timeline, clip.id, { text: { ...text, ...patch } }), live ? { live: true } : undefined);
  const canTrim = playhead > clip.start_ms && playhead < clipEnd(clip);
  const presets = cropPresets(config);
  const effects = effectsOffered(config);
  const pos = (n: number, a: string, b: string) => (n === 0 ? t("centred") : `${n > 0 ? a : b} ${Math.abs(Math.round(n * 100))}%`);

  return (
    <section className={cx("panel", "ve-panel ve-inspector")} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className={cx("heading", "ve-heading")}>
        {text ? t("titleHeading") : asset?.name || t("clipHeading")}
      </h2>

      {text ? (
        <fieldset>
          <legend>{t("text")}</legend>
          <div className={field}>
            <label htmlFor={`${uid}-text`}>{t("onScreenText")}</label>
            <textarea id={`${uid}-text`} className={input} rows={3} maxLength={500} value={text.content} onChange={(e) => setText({ content: e.target.value || " " }, true)} onBlur={onCommit} />
          </div>
          {range(t("size"), text.font_size, 0.02, 0.3, 0.005, (n) => updateClip(timeline, clip.id, { text: { ...text, font_size: n } }), (n) => `${Math.round(n * 100)}`)}
          <div className="ve-row">
            <div className={field}>
              <label htmlFor={`${uid}-colour`}>{t("colour")}</label>
              <input id={`${uid}-colour`} type="color" value={text.color} onChange={(e) => setText({ color: e.target.value }, true)} onBlur={onCommit} />
            </div>
            <div className={field}>
              <label htmlFor={`${uid}-align`}>{t("alignment")}</label>
              <select id={`${uid}-align`} className={input} value={text.align} onChange={(e) => setText({ align: e.target.value as "left" | "center" | "right" })}>
                <option value="left">{t("alignLeft")}</option>
                <option value="center">{t("alignCentre")}</option>
                <option value="right">{t("alignRight")}</option>
              </select>
            </div>
          </div>
          <div className={field}>
            <label><input type="checkbox" checked={text.weight === "bold"} onChange={(e) => setText({ weight: e.target.checked ? "bold" : "normal" })} /> {t("bold")}</label>
            <label><input type="checkbox" checked={text.italic} onChange={(e) => setText({ italic: e.target.checked })} /> {t("italic")}</label>
            <label><input type="checkbox" checked={text.background !== null} onChange={(e) => setText({ background: e.target.checked ? "#000000" : null })} /> {t("boxBehind")}</label>
          </div>
          {text.background !== null ? (
            <div className={field}>
              <label htmlFor={`${uid}-bg`}>{t("boxColour")}</label>
              <input id={`${uid}-bg`} type="color" value={text.background} onChange={(e) => setText({ background: e.target.value }, true)} onBlur={onCommit} />
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {f.trim || f.arrange || f.speed ? (
        <fieldset>
          <legend>{t("timing")}</legend>
          <div className="ve-row">
            {num(t("startsAt"), seconds(clip.start_ms), (n) => moveClip(timeline, clip.id, n * 1000), { min: 0 })}
            {f.trim ? num(t("length"), seconds(clip.duration_ms), (n) => trimEnd(timeline, clip.id, clip.start_ms + n * 1000), { min: MIN_CLIP_MS / 1000 }) : null}
          </div>
          {f.trim && clip.in_ms !== undefined ? num(t("startsIntoSource"), seconds(clip.in_ms), (n) => updateClip(timeline, clip.id, { in_ms: Math.max(0, Math.round(n * 1000)) }), { min: 0, hint: t("startsIntoSourceHint") }) : null}
          {f.trim ? (
            <div className={acts}>
              <button type="button" className={btn2} disabled={!canTrim} onClick={() => onChange(trimStart(timeline, clip.id, playhead))}>{t("trimStart")}</button>
              <button type="button" className={btn2} disabled={!canTrim} onClick={() => onChange(trimEnd(timeline, clip.id, playhead))}>{t("trimEnd")}</button>
            </div>
          ) : null}
          {f.arrange ? (
            <div className={acts} role="group" aria-label={t("alignGroup")}>
              <button type="button" className={btn2} onClick={() => onChange(alignClip(timeline, clip.id, "playhead", playhead))}>{t("alignPlayhead")}</button>
              <button type="button" className={btn2} onClick={() => onChange(alignClip(timeline, clip.id, "previous", playhead))}>{t("alignPrevious")}</button>
              <button type="button" className={btn2} onClick={() => onChange(alignClip(timeline, clip.id, "start", playhead))}>{t("alignStart")}</button>
            </div>
          ) : null}
          {f.speed && clip.speed !== undefined ? (
            <div className={field}>
              <label htmlFor={`${uid}-speed`}>{t("speed")}</label>
              <select id={`${uid}-speed`} className={input} value={clip.speed} onChange={(e) => onChange(setSpeed(timeline, clip.id, Number(e.target.value)))}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×{s === 1 ? ` ${t("speedNormal")}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {f.crop && hasPicture ? (
        <fieldset>
          <legend>{t("cropPositionSize")}</legend>
          {asset && asset.width ? (
            <div className={acts} role="group" aria-label={t("cropShape")}>
              {presets.map(([label, ratio]) => (
                <button key={label} type="button" className={btn2} onClick={() => onChange(updateClip(timeline, clip.id, { crop: cropToRatio(asset.width, asset.height, ratio) }))}>
                  {t("cropTo", { ratio: label })}
                </button>
              ))}
              <button type="button" className={btn2} onClick={() => onChange(updateClip(timeline, clip.id, { crop: { x: 0, y: 0, w: 1, h: 1 } }))}>{t("noCrop")}</button>
            </div>
          ) : null}
          {range(t("cropLeft"), crop.x, 0, 0.95, 0.01, (n) => setCrop({ x: n }), pct)}
          {range(t("cropTop"), crop.y, 0, 0.95, 0.01, (n) => setCrop({ y: n }), pct)}
          {range(t("widthKept"), crop.w, 0.05, 1, 0.01, (n) => setCrop({ w: n }), pct)}
          {range(t("heightKept"), crop.h, 0.05, 1, 0.01, (n) => setCrop({ h: n }), pct)}
        </fieldset>
      ) : null}

      {f.placement && track.kind !== "audio" ? (
        <fieldset>
          <legend>{t("placement")}</legend>
          {range(t("across"), clip.x, -1, 1, 0.01, (n) => updateClip(timeline, clip.id, { x: n }), (n) => pos(n, "right", "left"))}
          {range(t("upDown"), clip.y, -1, 1, 0.01, (n) => updateClip(timeline, clip.id, { y: n }), (n) => pos(n, "lower", "higher"))}
          {range(t("size"), clip.scale, 0.1, 3, 0.05, (n) => updateClip(timeline, clip.id, { scale: n }), pct)}
          {range(t("opacity"), clip.opacity, 0, 1, 0.01, (n) => updateClip(timeline, clip.id, { opacity: n }), pct)}
        </fieldset>
      ) : null}

      {f.fades ? (
        <fieldset>
          <legend>{track.kind === "audio" ? t("fadesSound") : t("fades")}</legend>
          {range(t("fadeIn"), clip.fade_in_ms / 1000, 0, Math.min(10, clip.duration_ms / 1000), 0.1, (n) => updateClip(timeline, clip.id, { fade_in_ms: Math.round(n * 1000) }), (n) => `${n.toFixed(1)} s`)}
          {range(t("fadeOut"), clip.fade_out_ms / 1000, 0, Math.min(10, clip.duration_ms / 1000), 0.1, (n) => updateClip(timeline, clip.id, { fade_out_ms: Math.round(n * 1000) }), (n) => `${n.toFixed(1)} s`)}
        </fieldset>
      ) : null}

      {f.volume && clip.volume !== undefined && asset?.kind !== "image" ? (
        <fieldset>
          <legend>{t("sound")}</legend>
          {range(t("volume"), clip.volume, 0, 2, 0.05, (n) => updateClip(timeline, clip.id, { volume: n }), pct)}
        </fieldset>
      ) : null}

      {hasPicture && effects.length > 0 ? (
        <fieldset>
          <legend>{t("effects")}</legend>
          {effects.map((type) => {
            const spec = EFFECTS[type];
            const current = clip.effects.find((e) => e.type === type)?.amount ?? spec.neutral;
            return range(t(`effect_${type}`), current, spec.min, spec.max, spec.step, (n) => setEffect(timeline, clip.id, { type, amount: n }), (n) => (n === spec.neutral ? t("effectOff") : `${n}${spec.unit}`));
          })}
        </fieldset>
      ) : null}
    </section>
  );
}
