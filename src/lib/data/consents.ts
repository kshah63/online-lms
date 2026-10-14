import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoConsents } from "@/lib/demo/data";
import type { LessonConsentKind } from "@/lib/types";

// ============================================================================
// lesson_consents, read under RLS: the household reads its own children's,
// staff read the rooms they reach, admins all. Written only by
// set_lesson_consent from the MathVision app — the room shows the states and
// says where they are managed.
// ============================================================================

export const CONSENT_KINDS: readonly LessonConsentKind[] = ["recording", "transcript", "ai_analysis", "integrity_camera"];

/** What happens to what a lesson leaves behind — the owner's decision, stated once where a family reads the consents. */
export const RETENTION_LINE = "Recordings are kept for one month and then deleted. Transcripts are kept; there is no automatic deletion.";

export const CONSENT_LABEL: Record<LessonConsentKind, { title: string; description: string }> = {
  recording: { title: "Audio recording", description: "The lesson's audio is recorded and kept for one month, then deleted. The family can replay it while this is granted." },
  transcript: { title: "Transcript", description: "The lesson is transcribed so the teacher's report can be drafted from what was actually said." },
  ai_analysis: { title: "AI analysis", description: "The transcript is analysed for the teacher's coaching and the report draft. Without it, only word counts are kept." },
  integrity_camera: { title: "Camera during tests", description: "During a timed test at home, occasional camera snapshots are taken so a flagged test can be reviewed." },
};

/** One consent's state for one child. A row with revoked_at null is in force. */
export interface ConsentState {
  kind: LessonConsentKind;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
}

/** The four consent states per student, for the students the viewer may read. A student with no rows has four ungranted states. */
export async function getLessonConsents(studentIds: string[]): Promise<Map<string, ConsentState[]>> {
  const out = new Map<string, ConsentState[]>();
  const blank = (): ConsentState[] => CONSENT_KINDS.map((kind) => ({ kind, granted: false, granted_at: null, revoked_at: null }));
  for (const id of studentIds) out.set(id, blank());
  if (studentIds.length === 0) return out;

  if (isDemoMode) {
    for (const id of studentIds) {
      const c = demoConsents[id];
      if (!c) continue;
      out.set(
        id,
        CONSENT_KINDS.map((kind) => ({ kind, granted: Boolean(c[kind]), granted_at: c[kind] ? "2026-09-01T02:00:00.000Z" : null, revoked_at: null })),
      );
    }
    return out;
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("lesson_consents").select("student_id, kind, granted_at, revoked_at").in("student_id", studentIds);
  if (error) throw new Error(`lesson_consents failed: ${error.message}`);
  for (const row of (data ?? []) as { student_id: string; kind: string; granted_at: string | null; revoked_at: string | null }[]) {
    const states = out.get(row.student_id);
    const state = states?.find((s) => s.kind === row.kind);
    if (!state) continue;
    state.granted = row.revoked_at == null;
    state.granted_at = row.granted_at;
    state.revoked_at = row.revoked_at;
  }
  return out;
}
