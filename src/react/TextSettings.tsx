import { useId } from "react";
import { TEXT_ANIMATIONS, applyTextPreset, type FontCategory, type TextAnimation } from "../core/text";
import { updateClip, type Clip, type TextStyle, type Timeline } from "../core/timeline";
import { useCx, useEditor } from "./context";

interface Props {
  timeline: Timeline;
  clip: Clip;
  text: TextStyle;
  onChange: (next: Timeline, opts?: { live?: boolean }) => void;
  onCommit: () => void;
}

const CATEGORY_ORDER: FontCategory[] = ["sans", "serif", "display", "handwriting", "mono"];
const ANIMATION_LENGTHS = [200, 300, 500, 800, 1200, 2000];

/** Colour swatches plus a picker for any other colour. A radio group, so it works from the keyboard. */
function Swatches({ label, value, onPick, onCommit }: { label: string; value: string; onPick: (colour: string, live?: boolean) => void; onCommit: () => void }) {
  const { config, t } = useEditor();
  const uid = useId();
  const known = config.text.colours.some((c) => c.value.toLowerCase() === value.toLowerCase());
  return (
    <div className="ve-field ve-swatches-field">
      <span id={`${uid}-l`} className="ve-swatches__label">{label}</span>
      <div className="ve-swatches" role="radiogroup" aria-labelledby={`${uid}-l`}>
        {config.text.colours.map((c) => {
          const on = c.value.toLowerCase() === value.toLowerCase();
          return (
            <button key={c.value} type="button" role="radio" aria-checked={on} className="ve-swatch" style={{ background: c.value }} title={c.name} aria-label={c.name}
              onClick={() => onPick(c.value)} />
          );
        })}
        <label className="ve-swatch ve-swatch--custom" data-on={!known || undefined} title={t("otherColour")}>
          <span className="ve-visually-hidden">{t("otherColour")}</span>
          <input type="color" value={value} onChange={(e) => onPick(e.target.value, true)} onBlur={onCommit} />
        </label>
      </div>
    </div>
  );
}

/** A title's look: words, font, size, colour, outline, shadow, box, and how it comes in and goes out. */
export function TextSettings({ timeline, clip, text, onChange, onCommit }: Props) {
  const { config, t } = useEditor();
  const cx = useCx();
  const uid = useId();
  const field = cx("field", "ve-field");
  const input = cx("input", "ve-input");
  const set = (patch: Partial<TextStyle>, live = false) => onChange(updateClip(timeline, clip.id, { text: { ...text, ...patch } }), live ? { live: true } : undefined);
  const slider = (key: string, label: string, value: number, min: number, max: number, step: number, apply: (n: number) => Partial<TextStyle>, show: (n: number) => string) => (
    <div className={field}>
      <label htmlFor={`${uid}-${key}`}>
        {label}: <output htmlFor={`${uid}-${key}`}>{show(value)}</output>
      </label>
      <input id={`${uid}-${key}`} className={input} type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(apply(Number(e.target.value)), true)} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    </div>
  );
  const fonts = config.text.fonts;
  const font = fonts.find((f) => f.id === text.font) ?? fonts[0];
  const shadow = text.shadow ?? (text.background ? "none" : "soft");
  const animation = text.animation ?? { in: "none" as TextAnimation, out: "none" as TextAnimation, in_ms: 500, out_ms: 400 };
  const setAnimation = (patch: Partial<typeof animation>) => {
    const next = { ...animation, ...patch };
    const off = next.in === "none" && next.out === "none";
    const { animation: _drop, ...rest } = text;
    // An animation replaces the clip's plain fades (the two would otherwise stack).
    onChange(updateClip(timeline, clip.id, { text: off ? rest : { ...text, animation: next }, ...(off ? {} : { fade_in_ms: 0, fade_out_ms: 0 }) }));
  };
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <>
      <fieldset>
        <legend>{t("text")}</legend>
        <div className={field}>
          <label htmlFor={`${uid}-text`}>{t("onScreenText")}</label>
          <textarea id={`${uid}-text`} className={input} rows={3} maxLength={500} value={text.content} onChange={(e) => set({ content: e.target.value || " " }, true)} onBlur={onCommit} />
        </div>
        {config.text.presets.length > 0 ? (
          <div className={field}>
            <label htmlFor={`${uid}-preset`}>{t("textStyle")}</label>
            <select id={`${uid}-preset`} className={input} value="" onChange={(e) => {
              const preset = config.text.presets.find((p) => p.id === e.target.value);
              if (preset) onChange(applyTextPreset(timeline, clip.id, preset));
            }}>
              <option value="">{t("chooseTextStyle")}</option>
              {config.text.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        ) : null}
        <div className={field}>
          <label htmlFor={`${uid}-font`}>{t("font")}</label>
          <select id={`${uid}-font`} className={input} value={font?.id ?? ""} style={{ fontFamily: font?.family }} onChange={(e) => set({ font: e.target.value })}>
            {CATEGORY_ORDER.map((cat) => {
              const list = fonts.filter((f) => f.category === cat);
              return list.length ? (
                <optgroup key={cat} label={t(`fontCategory_${cat}`)}>
                  {list.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </div>
        {slider("size", t("size"), text.font_size, 0.02, 0.3, 0.005, (n) => ({ font_size: n }), (n) => `${Math.round(n * 100)}`)}
        <Swatches label={t("colour")} value={text.color} onPick={(c, live) => set({ color: c }, live)} onCommit={onCommit} />
        <div className="ve-row">
          <div className={field}>
            <label htmlFor={`${uid}-align`}>{t("alignment")}</label>
            <select id={`${uid}-align`} className={input} value={text.align} onChange={(e) => set({ align: e.target.value as TextStyle["align"] })}>
              <option value="left">{t("alignLeft")}</option>
              <option value="center">{t("alignCentre")}</option>
              <option value="right">{t("alignRight")}</option>
            </select>
          </div>
        </div>
        <div className={`${field} ve-checks`}>
          <label><input type="checkbox" checked={text.weight === "bold"} onChange={(e) => set({ weight: e.target.checked ? "bold" : "normal" })} /> {t("bold")}</label>
          <label><input type="checkbox" checked={text.italic} onChange={(e) => set({ italic: e.target.checked })} /> {t("italic")}</label>
          <label><input type="checkbox" checked={!!text.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> {t("capitals")}</label>
        </div>
        {slider("spacing", t("letterSpacing"), text.letter_spacing ?? 0, -0.1, 0.5, 0.01, (n) => ({ letter_spacing: n }), (n) => n.toFixed(2))}
        {slider("lines", t("lineSpacing"), text.line_height ?? 1.25, 0.8, 2.5, 0.05, (n) => ({ line_height: n }), (n) => n.toFixed(2))}
      </fieldset>

      <fieldset>
        <legend>{t("outlineShadowBox")}</legend>
        <div className={`${field} ve-checks`}>
          <label><input type="checkbox" checked={!!text.outline} onChange={(e) => set({ outline: e.target.checked ? { color: "#000000", width: 0.06 } : null })} /> {t("outline")}</label>
        </div>
        {text.outline ? (
          <>
            <Swatches label={t("outlineColour")} value={text.outline.color} onPick={(c, live) => set({ outline: { ...text.outline!, color: c } }, live)} onCommit={onCommit} />
            {slider("ow", t("outlineWidth"), text.outline.width, 0.01, 0.3, 0.01, (n) => ({ outline: { ...text.outline!, width: n } }), pct)}
          </>
        ) : null}
        <div className={field}>
          <label htmlFor={`${uid}-shadow`}>{t("shadow")}</label>
          <select id={`${uid}-shadow`} className={input} value={shadow} onChange={(e) => set({ shadow: e.target.value as NonNullable<TextStyle["shadow"]> })}>
            <option value="none">{t("shadow_none")}</option>
            <option value="soft">{t("shadow_soft")}</option>
            <option value="hard">{t("shadow_hard")}</option>
            <option value="glow">{t("shadow_glow")}</option>
          </select>
        </div>
        {shadow === "hard" || shadow === "glow" ? (
          <Swatches label={shadow === "glow" ? t("glowColour") : t("shadowColour")} value={text.shadow_color ?? (shadow === "glow" ? text.color : "#000000")} onPick={(c, live) => set({ shadow_color: c }, live)} onCommit={onCommit} />
        ) : null}
        <div className={`${field} ve-checks`}>
          <label><input type="checkbox" checked={text.background !== null} onChange={(e) => set({ background: e.target.checked ? "#000000" : null })} /> {t("boxBehind")}</label>
        </div>
        {text.background !== null ? (
          <>
            <Swatches label={t("boxColour")} value={text.background} onPick={(c, live) => set({ background: c }, live)} onCommit={onCommit} />
            {slider("bo", t("boxOpacity"), text.box_opacity ?? 1, 0.1, 1, 0.05, (n) => ({ box_opacity: n }), pct)}
            {slider("br", t("boxRoundness"), text.box_radius ?? 0, 0, 1, 0.05, (n) => ({ box_radius: n }), pct)}
          </>
        ) : null}
      </fieldset>

      <fieldset>
        <legend>{t("animation")}</legend>
        {(["in", "out"] as const).map((end) => (
          <div className="ve-row" key={end}>
            <div className={field}>
              <label htmlFor={`${uid}-a-${end}`}>{end === "in" ? t("animationIn") : t("animationOut")}</label>
              <select id={`${uid}-a-${end}`} className={input} value={animation[end]} onChange={(e) => setAnimation({ [end]: e.target.value as TextAnimation })}>
                {TEXT_ANIMATIONS.map((a) => <option key={a} value={a}>{t(`anim_${a}`)}</option>)}
              </select>
            </div>
            <div className={field}>
              <label htmlFor={`${uid}-a-${end}-ms`}>{t("animationLength")}</label>
              <select id={`${uid}-a-${end}-ms`} className={input} disabled={animation[end] === "none"} value={animation[`${end}_ms`]}
                onChange={(e) => setAnimation({ [`${end}_ms`]: Number(e.target.value) })}>
                {[...new Set([...ANIMATION_LENGTHS, animation[`${end}_ms`]])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{(n / 1000).toFixed(1)} s</option>)}
              </select>
            </div>
          </div>
        ))}
        <span className="ve-hint">{t("animationHint")}</span>
      </fieldset>
    </>
  );
}
