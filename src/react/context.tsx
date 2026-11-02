import { createContext, useContext, type ReactNode } from "react";
import type { EditorAdapter } from "../core/adapter";
import type { EditorConfig } from "../core/config";
import type { Translate } from "../core/labels";

/** Extra class names a host can add to the parts of the editor, to fit its own styles. */
export type ClassNames = Partial<Record<"root" | "panel" | "heading" | "button" | "buttonSecondary" | "field" | "input" | "actions" | "alert" | "timeline" | "clip", string>>;

export interface EditorContextValue {
  config: EditorConfig;
  adapter: EditorAdapter;
  t: Translate;
  classNames: ClassNames;
}

const Context = createContext<EditorContextValue | null>(null);

export function EditorProvider({ value, children }: { value: EditorContextValue; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useEditor(): EditorContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("Editor parts must be used inside <VideoEditor>");
  return value;
}

/** Joins the editor's own class with any the host added for that part. */
export function useCx() {
  const { classNames } = useEditor();
  return (part: keyof ClassNames, own: string) => [own, classNames[part]].filter(Boolean).join(" ");
}
