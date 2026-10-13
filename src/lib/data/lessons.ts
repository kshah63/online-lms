import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoLessonRoomState, buildDemoOnlineLessons } from "@/lib/demo/data";
import { NO_CONSENTS, type LessonRoomState, type OnlineLesson, type Profile, type RoomConsents } from "@/lib/types";

// ============================================================================
// The sessions seam. The booking IS the lesson: an online session_requests row.
// The room never selects session_requests itself; two RPCs answer everything.
//   my_online_lessons(p_days) — the viewer's online lessons, with their seat
//   lesson_room_state(p_session_id) — one row for a viewer with a seat, or none
// An RPC error is surfaced, never feature-detected around.
// ============================================================================

/** The viewer's online lessons within ±days (host, learner, family or observer rows). */
export async function listMyOnlineLessons(viewer: Profile, days = 14): Promise<OnlineLesson[]> {
  if (isDemoMode) return buildDemoOnlineLessons(viewer, days);

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("my_online_lessons", { p_days: days });
  if (error) throw new Error(`my_online_lessons failed: ${error.message}`);
  return ((data ?? []) as OnlineLesson[]).map((row) => ({ ...row, draft_ready: Boolean(row.draft_ready) }));
}

/** One lesson from the viewer's list, by session id (null when it is not theirs or outside ±days). */
export async function getMyOnlineLesson(viewer: Profile, sessionId: string, days = 30): Promise<OnlineLesson | null> {
  const rows = await listMyOnlineLessons(viewer, days);
  return rows.find((r) => r.session_id === sessionId) ?? null;
}

/** The room state for a session, or null when the viewer has no seat (room_access is null). */
export async function getLessonRoomState(viewer: Profile, sessionId: string): Promise<LessonRoomState | null> {
  if (isDemoMode) return buildDemoLessonRoomState(sessionId, viewer);

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("lesson_room_state", { p_session_id: sessionId }).maybeSingle();
  if (error) throw new Error(`lesson_room_state failed: ${error.message}`);
  if (!data) return null;
  const row = data as LessonRoomState & { consents: Partial<RoomConsents> | null };
  return { ...row, recording_enabled: Boolean(row.recording_enabled), consents: normaliseConsents(row.consents) };
}

/** The consents jsonb may omit a kind; a missing kind is not granted. */
export function normaliseConsents(c: Partial<RoomConsents> | null | undefined): RoomConsents {
  return {
    recording: Boolean(c?.recording),
    transcript: Boolean(c?.transcript),
    ai_analysis: Boolean(c?.ai_analysis),
    integrity_camera: Boolean(c?.integrity_camera),
  };
}

export { NO_CONSENTS };
