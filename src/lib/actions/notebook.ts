"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";

// ============================================================================
// Notebook persistence on mv-app's lesson_notebooks (one running notebook per
// student per course, jsonb tldraw_snapshot). Reads go through RLS by id;
// writes go through rpc save_lesson_notebook. Real-time collaboration still
// rides on the Supabase Realtime broadcast channel (use-notebook-sync.ts) for
// this stage; these actions handle the durable snapshot.
// ============================================================================

export async function loadNotebookSnapshot(notebookId: string | null): Promise<unknown | null> {
  if (isDemoMode || !notebookId) return null; // demo uses local IndexedDB persistence
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("lesson_notebooks")
    .select("tldraw_snapshot")
    .eq("id", notebookId)
    .maybeSingle();
  if (error) {
    // A snapshot-load failure must never take down the lesson room — the
    // canvas just starts empty. Surface the cause in server logs.
    console.error("lesson_notebooks read failed:", error.message);
    return null;
  }
  return data?.tldraw_snapshot ?? null;
}

export async function saveNotebookSnapshot(notebookId: string | null, snapshot: unknown): Promise<void> {
  if (isDemoMode) return;
  if (!notebookId) throw new Error("This lesson has no notebook to save to.");
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("save_lesson_notebook", { p_notebook_id: notebookId, p_snapshot: snapshot });
  if (error) throw new Error(`save_lesson_notebook failed: ${error.message}`);
}
