"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";

// ============================================================================
// §5 Notebook persistence. The running document is stored on `notebooks`
// (jsonb tldraw_snapshot), loaded each lesson and saved continuously. Real-time
// collaboration between teacher and student rides on Supabase Realtime
// (see use-notebook-sync.ts); these actions handle the durable snapshot.
// ============================================================================

export async function loadNotebookSnapshot(notebookId: string): Promise<unknown | null> {
  if (isDemoMode) return null; // demo uses local IndexedDB persistence
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("notebooks")
    .select("tldraw_snapshot")
    .eq("id", notebookId)
    .maybeSingle();
  if (error) {
    // A snapshot-load failure must never take down the lesson room — the
    // canvas just starts empty. Surface the cause in server logs.
    console.error("loadNotebookSnapshot failed:", error.message);
    return null;
  }
  return data?.tldraw_snapshot ?? null;
}

export async function saveNotebookSnapshot(notebookId: string, snapshot: unknown): Promise<void> {
  if (isDemoMode) return;
  const supabase = createSupabaseServerClient()!;
  await supabase
    .from("notebooks")
    .update({ tldraw_snapshot: snapshot, updated_at: new Date().toISOString() })
    .eq("id", notebookId);
}
