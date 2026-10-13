"use client";

import { useCallback, useEffect } from "react";
import { useSetAtom } from "jotai";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { useNotebookSync } from "@/lib/notebook/use-notebook-sync";
import { notebookEditorAtom } from "@/lib/notebook/editor-atom";

/**
 * Collaborative notebook. tldraw wired to Supabase Realtime so the teacher
 * and student edit live, with the running document persisted per student per
 * course on lesson_notebooks.
 * Without Supabase configured it falls back to local IndexedDB persistence.
 */
export function NotebookPanel({
  notebookId,
  saveId,
  userId,
  userName,
  initialSnapshot,
}: {
  notebookId: string;
  saveId: string | null;
  userId: string;
  userName: string;
  initialSnapshot: unknown | null;
}) {
  const { onMount, dispose, syncing } = useNotebookSync({
    notebookId,
    saveId,
    userId,
    userName,
    initialSnapshot,
  });

  useEffect(() => dispose, [dispose]);

  // Expose the editor so side panels (materials, activities) can add to the canvas.
  const setEditor = useSetAtom(notebookEditorAtom);
  const handleMount = useCallback(
    (editor: Editor) => {
      setEditor(editor);
      onMount?.(editor);
    },
    [onMount, setEditor],
  );
  useEffect(() => () => setEditor(null), [setEditor]);

  return (
    <div className="absolute inset-0">
      <Tldraw onMount={handleMount} persistenceKey={syncing ? undefined : `notebook-${notebookId}`} />
    </div>
  );
}
