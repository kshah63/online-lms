import { atom } from "jotai";
import type { Editor } from "tldraw";

/** The live tldraw editor for the current lesson room, so side panels can add to it. */
export const notebookEditorAtom = atom<Editor | null>(null);
