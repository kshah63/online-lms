"use client";

import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";

/**
 * §5 Collaborative notebook. tldraw with a per-notebook persistence key so the
 * document builds up across lessons (one running notebook per student/course).
 * Real-time Supabase sync between teacher and student is a later build step;
 * locally this persists to IndexedDB.
 */
export function NotebookPanel({ notebookId }: { notebookId: string }) {
  return (
    <div className="absolute inset-0">
      <Tldraw persistenceKey={`notebook-${notebookId}`} />
    </div>
  );
}
