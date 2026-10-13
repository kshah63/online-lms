import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessionRequests, demoConsents } from "@/lib/demo/data";
import { demoReadsRecording, demoRecordings } from "@/lib/demo/brief";
import type { Profile } from "@/lib/types";

// ============================================================================
// lesson_recordings, read under the caller's RLS: the lesson's teacher, the
// room's in-charge, an admin — and the household, but only while the
// recording consent for that child is in force (lesson_recordings_select).
// The bytes stay at Daily; the room only ever asks it for a short-lived link.
// ============================================================================

export interface LessonRecording {
  session_id: string;
  provider_recording_id: string | null;
  duration_s: number | null;
  recorded_at: string | null;
  expires_at: string | null;
  deleted_at: string | null;
}

export const LESSON_RECORDING_COLUMNS = "session_id, provider_recording_id, duration_s, recorded_at, expires_at, deleted_at";

/** The recording row for a lesson, or null when there is none the viewer may see. */
export async function getLessonRecording(viewer: Profile, sessionId: string): Promise<LessonRecording | null> {
  if (isDemoMode) {
    const s = buildDemoSessionRequests().find((x) => x.id === sessionId);
    const consentOn = s ? Boolean(demoConsents[s.student_id]?.recording) : false;
    if (!demoReadsRecording(viewer, sessionId, consentOn)) return null;
    return demoRecordings().find((r) => r.session_id === sessionId) ?? null;
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("lesson_recordings").select(LESSON_RECORDING_COLUMNS).eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`lesson_recordings failed: ${error.message}`);
  return (data as LessonRecording | null) ?? null;
}

/** A recording that can still be played: it has a provider id and has not been marked for deletion. */
export function recordingIsAvailable(r: LessonRecording | null): r is LessonRecording & { provider_recording_id: string } {
  return r != null && r.provider_recording_id != null && r.deleted_at == null;
}
