"use client";

import { useEffect } from "react";
import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { useNotebookSync } from "@/lib/notebook/use-notebook-sync";

/**
 * §5 Collaborative notebook. tldraw wired to Supabase Realtime so the teacher
 * and student edit live, with the running document persisted per student/course.
 * Without Supabase configured it falls back to local IndexedDB persistence.
 */
export function NotebookPanel({
  notebookId,
  userId,
  userName,
  initialSnapshot,
}: {
  notebookId: string;
  userId: string;
  userName: string;
  initialSnapshot: unknown | null;
}) {
  const { onMount, dispose, syncing } = useNotebookSync({
    notebookId,
    userId,
    userName,
    initialSnapshot,
  });

  useEffect(() => dispose, [dispose]);

  return (
    <div className="absolute inset-0">
      <Tldraw onMount={onMount} persistenceKey={syncing ? undefined : `notebook-${notebookId}`} />
    </div>
  );
}
