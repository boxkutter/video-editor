/**
 * Titles: fonts, colours, ready-made text styles, and the entry and exit animations of a title.
 * The fonts are the host's (it loads them, for example as self-hosted web fonts); the editor only
 * names them. Everything here is plain data or plain maths, so it is the same in the preview and in
 * the exported video.
 */
import { clipEnd, findClip, firstFit, newId, track, updateClip, type Clip, type TextStyle, type Timeline } from "./timeline";

export type FontCategory = "sans" | "serif" | "display" | "handwriting" | "mono";

export interface FontChoice {
  /** Stored in the timeline (`text.font`). Keep it stable. */
  id: string;
  label: string;
  /** A CSS font-family list; the host makes sure the first family can load (or is installed). */
  family: string;
  category: FontCategory;
  /** The font has a bold weight of its own (otherwise the browser thickens it). */
  bold?: boolean;
}

export interface NamedColour {
  value: string;
  name: string;
}

export const TEXT_ANIMATIONS = ["none", "fade", "from_below", "from_above", "from_left", "from_right", "pop", "zoom", "bounce", "blur", "wipe", "typewriter", "words"] as const;
export type TextAnimation = (typeof TEXT_ANIMATIONS)[number];

export interface TextPreset {
  id: string;
  label: string;
  /** Groups the presets on the Text tab. */
  group: "professional" | "social" | "fun";
  /** The style, without the words (a preset keeps a title's own words). */
  style: Omit<Partial<TextStyle>, "content">;
  /** Where it sits: offsets as on every clip (-1 to 1). */
  x?: number;
  y?: number;
  /** Shown on the tile and used as the words of a new title. */
  sample?: string;
}

/** Fonts every computer has some version of, so the editor works before a host adds its own. */
export const SYSTEM_FONTS: FontChoice[] = [
  { id: "system", label: "System sans", family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', category: "sans", bold: true },
  { id: "rounded", label: "Rounded", family: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif', category: "sans", bold: true },
  { id: "condensed", label: "Condensed", family: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue Condensed", sans-serif', category: "sans", bold: true },
  { id: "serif", label: "Classic serif", family: 'Georgia, Cambria, "Times New Roman", serif', category: "serif", bold: true },
  { id: "impact", label: "Impact", family: 'Impact, Haettenschweiler, "Arial Black", sans-serif', category: "display" },
  { id: "hand", label: "Handwritten", family: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive', category: "handwriting" },
  { id: "mono", label: "Typewriter", family: 'ui-monospace, "Courier New", monospace', category: "mono", bold: true },
];
export const DEFAULT_FONT_FAMILY = SYSTEM_FONTS[0]!.family;

export const DEFAULT_COLOURS: NamedColour[] = [
  { value: "#ffffff", name: "White" },
  { value: "#f5f0e6", name: "Cream" },
  { value: "#c9ced6", name: "Silver" },
  { value: "#4a4f57", name: "Slate" },
  { value: "#111111", name: "Black" },
  { value: "#e63946", name: "Red" },
  { value: "#ff6b5b", name: "Coral" },
  { value: "#ff8c1a", name: "Orange" },
  { value: "#ffc233", name: "Amber" },
  { value: "#ffe94d", name: "Yellow" },
  { value: "#a3e635", name: "Lime" },
  { value: "#22a95b", name: "Green" },
  { value: "#14b8a6", name: "Teal" },
  { value: "#22d3ee", name: "Cyan" },
  { value: "#3b82f6", name: "Blue" },
  { value: "#1e3a8a", name: "Navy" },
  { value: "#7c3aed", name: "Violet" },
  { value: "#d946ef", name: "Magenta" },
  { value: "#ff5fa2", name: "Pink" },
  { value: "#c9a227", name: "Gold" },
];

const anim = (into: TextAnimation, out: TextAnimation = "fade", in_ms = 500, out_ms = 400) => ({ in: into, out, in_ms, out_ms });

/** Styles that only use the system fonts. A host with its own fonts passes its own presets. */
export const DEFAULT_TEXT_PRESETS: TextPreset[] = [
  { id: "headline", label: "Headline", group: "professional", y: -0.1, style: { font: "system", font_size: 0.085, weight: "bold", color: "#ffffff", shadow: "soft", animation: anim("from_below") } },
  { id: "lower_third", label: "Lower third", group: "professional", x: -0.45, y: 0.62, sample: "Sam Lee · Director", style: { font: "system", font_size: 0.04, weight: "bold", align: "left", color: "#ffffff", background: "#111111", box_opacity: 0.8, box_radius: 0.3, shadow: "none", animation: anim("from_left", "fade", 450, 300) } },
  { id: "caption", label: "Caption bar", group: "professional", y: 0.78, style: { font: "system", font_size: 0.045, weight: "normal", color: "#ffffff", background: "#000000", box_opacity: 0.6, shadow: "none", animation: anim("fade") } },
  { id: "quote", label: "Quote", group: "professional", sample: "“Say it simply.”", style: { font: "serif", font_size: 0.065, weight: "normal", italic: true, color: "#f5f0e6", shadow: "soft", line_height: 1.3, animation: anim("words", "fade", 1200) } },
  { id: "label", label: "Label", group: "professional", y: -0.75, sample: "NEW", style: { font: "condensed", font_size: 0.04, weight: "bold", uppercase: true, letter_spacing: 0.18, color: "#111111", background: "#ffffff", box_radius: 1, shadow: "none", animation: anim("pop") } },
  { id: "big_bold", label: "Big and bold", group: "social", style: { font: "impact", font_size: 0.12, uppercase: true, color: "#ffffff", outline: { color: "#000000", width: 0.08 }, shadow: "none", animation: anim("pop", "zoom", 350, 250) } },
  { id: "highlight", label: "Highlight", group: "social", style: { font: "system", font_size: 0.07, weight: "bold", color: "#111111", background: "#ffe94d", box_radius: 0.4, shadow: "none", animation: anim("wipe", "fade", 500) } },
  { id: "neon", label: "Neon", group: "fun", style: { font: "rounded", font_size: 0.085, weight: "bold", color: "#ffffff", shadow: "glow", shadow_color: "#d946ef", animation: anim("blur", "blur") } },
  { id: "handwritten", label: "Handwritten note", group: "fun", style: { font: "hand", font_size: 0.075, color: "#ffffff", shadow: "soft", animation: anim("typewriter", "fade", 1200) } },
  { id: "retro", label: "Retro", group: "fun", style: { font: "impact", font_size: 0.1, color: "#ffc233", shadow: "hard", shadow_color: "#e63946", animation: anim("bounce", "from_below", 700) } },
  { id: "typewriter", label: "Typewriter", group: "fun", style: { font: "mono", font_size: 0.055, color: "#f5f0e6", shadow: "soft", animation: anim("typewriter", "fade", 1500) } },
];

export function baseText(content: string): TextStyle {
  return { content, font_size: 0.07, align: "center", weight: "bold", italic: false, color: "#ffffff", background: null };
}

/** A title made from a preset, on the text track (made if missing), at `at` or the first free place after it. */
export function addStyledTitle(timeline: Timeline, at: number, preset: TextPreset | null, content?: string): { timeline: Timeline; clipId: string } {
  let target = timeline.tracks.find((t) => t.kind === "text");
  let working = timeline;
  if (!target) {
    target = track("text", "Titles");
    working = { ...timeline, tracks: [...timeline.tracks, target] };
  }
  const words = content ?? preset?.sample ?? preset?.label ?? "Your title";
  const clip: Clip = {
    id: newId("c"), start_ms: firstFit(target, at, 4000), duration_ms: 4000, fade_in_ms: 0, fade_out_ms: 0,
    x: preset?.x ?? 0, y: preset?.y ?? 0.7, scale: 1, opacity: 1, effects: [],
    text: { ...baseText(words), ...(preset?.style ?? {}) },
  };
  if (!preset?.style.animation) { clip.fade_in_ms = 300; clip.fade_out_ms = 300; }
  const id = target.id;
  const placed = { ...working, tracks: working.tracks.map((t) => (t.id === id ? { ...t, clips: [...t.clips, clip] } : t)) };
  return { timeline: placed, clipId: clip.id };
}

/** Restyle a title with a preset, keeping its words (and its place, unless the preset sets one). */
export function applyTextPreset(timeline: Timeline, clipId: string, preset: TextPreset): Timeline {
  const found = findClip(timeline, clipId);
  if (!found?.clip.text) return timeline;
  const text: TextStyle = { ...baseText(found.clip.text.content), ...preset.style, content: found.clip.text.content };
  return updateClip(timeline, clipId, { text, x: preset.x ?? found.clip.x, y: preset.y ?? found.clip.y, ...(preset.style.animation ? { fade_in_ms: 0, fade_out_ms: 0 } : {}) });
}

// --- animation ----------------------------------------------------------------------------------

/** How a title is drawn at a moment: offsets in font sizes, a scale, and how much of it shows. */
export interface TextFrame {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** 0 to 1: the share of the letters (typewriter) or words (words) shown. */
  reveal: number;
  revealBy: "letters" | "words";
  /** Blur, in font sizes. */
  blur: number;
  /** 0 to 1: the share of the width shown, from the left. */
  wipe: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
function backOut(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}
function bounceOut(p: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
}

/** One animation at progress `p` (0 = hidden, 1 = fully shown), applied onto `f`. */
function applyAnimation(f: TextFrame, kind: TextAnimation, p: number): void {
  if (kind === "none" || p >= 1) return;
  const e = easeOut(p);
  switch (kind) {
    case "fade": f.alpha *= e; break;
    case "from_below": f.dy += (1 - e) * 1.2; f.alpha *= clamp01(p * 2); break;
    case "from_above": f.dy -= (1 - e) * 1.2; f.alpha *= clamp01(p * 2); break;
    case "from_left": f.dx -= (1 - e) * 3; f.alpha *= clamp01(p * 2); break;
    case "from_right": f.dx += (1 - e) * 3; f.alpha *= clamp01(p * 2); break;
    case "pop": f.scale *= 0.3 + 0.7 * backOut(p); f.alpha *= clamp01(p * 3); break;
    case "zoom": f.scale *= 1 + (1 - e) * 0.6; f.alpha *= e; break;
    case "bounce": f.dy -= (1 - bounceOut(p)) * 2.5; f.alpha *= clamp01(p * 4); break;
    case "blur": f.blur = Math.max(f.blur, (1 - e) * 0.5); f.alpha *= e; break;
    case "wipe": f.wipe = Math.min(f.wipe, e); break;
    case "typewriter": f.reveal = Math.min(f.reveal, p); f.revealBy = "letters"; break;
    case "words": f.reveal = Math.min(f.reveal, p); f.revealBy = "words"; break;
  }
}

export function textFrame(clip: Clip, at: number): TextFrame {
  const f: TextFrame = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1, revealBy: "letters", blur: 0, wipe: 1 };
  const a = clip.text?.animation;
  if (!a) return f;
  const length = clip.duration_ms;
  // Entry and exit never overlap: each gets at most half the clip.
  const inMs = Math.min(a.in_ms, length / 2);
  const outMs = Math.min(a.out_ms, length / 2);
  if (inMs > 0) applyAnimation(f, a.in, clamp01((at - clip.start_ms) / inMs));
  if (outMs > 0) applyAnimation(f, a.out, clamp01((clipEnd(clip) - at) / outMs));
  return f;
}

/** The part of `lines` shown at `reveal`, letter by letter or word by word, keeping the line breaks. */
export function revealLines(lines: string[], reveal: number, by: "letters" | "words"): string[] {
  if (reveal >= 1) return lines;
  if (by === "letters") {
    let left = Math.floor([...lines.join("")].length * reveal);
    return lines.map((line) => {
      const chars = [...line];
      const shown = chars.slice(0, Math.max(0, left)).join("");
      left -= chars.length;
      return shown;
    });
  }
  const total = lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0);
  let left = Math.ceil(total * reveal);
  return lines.map((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    const shown = words.slice(0, Math.max(0, left)).join(" ");
    left -= words.length;
    return shown;
  });
}

/** CSS approximating a style, for tiles and menus (the canvas draws the real thing). */
export function previewCss(style: Partial<TextStyle>, family: string): Record<string, string | number> {
  const css: Record<string, string | number> = {
    fontFamily: family,
    fontWeight: style.weight === "bold" ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color ?? "#ffffff",
    textTransform: style.uppercase ? "uppercase" : "none",
    letterSpacing: `${style.letter_spacing ?? 0}em`,
  };
  if (style.background) {
    css.background = hexWithAlpha(style.background, style.box_opacity ?? 1);
    css.padding = "0 0.3em";
    css.borderRadius = `${(style.box_radius ?? 0) * 0.4}em`;
  }
  if (style.outline) css.WebkitTextStroke = `${Math.max(1, style.outline.width * 12)}px ${style.outline.color}`;
  const shadow = style.shadow ?? (style.background ? "none" : "soft");
  if (shadow === "soft") css.textShadow = "0 1px 4px rgb(0 0 0 / 0.6)";
  if (shadow === "hard") css.textShadow = `0.06em 0.06em 0 ${style.shadow_color ?? "#000000"}`;
  if (shadow === "glow") css.textShadow = `0 0 0.25em ${style.shadow_color ?? style.color ?? "#ffffff"}, 0 0 0.5em ${style.shadow_color ?? style.color ?? "#ffffff"}`;
  return css;
}

/** `#rrggbb` with an opacity, as `rgb(r g b / a)`. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgb(${parseInt(m[1]!, 16)} ${parseInt(m[2]!, 16)} ${parseInt(m[3]!, 16)} / ${clamp01(alpha)})`;
}
