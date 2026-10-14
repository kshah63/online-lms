import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoTeacherScorecard } from "@/lib/demo/scorecard";
import { scorecardFromRpc, type TeacherScorecard } from "@/lib/coaching/scorecard";
import type { Profile } from "@/lib/types";

// ============================================================================
// The teacher scorecard's data. One RPC answers it: teacher_scorecard(
// p_teacher_id, p_days) decides the window and aggregates every block under
// its own gate (the teacher themself, an admin, or an in-charge of a room the
// teacher taught in inside the window — support and a wrong-room in-charge
// are refused), and the room maps the jsonb with src/lib/coaching/scorecard.ts.
// A refusal comes back as the database's sentence, never as an empty card.
// ============================================================================

/** rpc teacher_scorecard for one teacher and window. Throws the database's refusal as a sentence. */
export async function getTeacherScorecard(viewer: Profile, teacherId: string, days: number): Promise<TeacherScorecard> {
  if (isDemoMode) return scorecardFromRpc(buildDemoTeacherScorecard(viewer, teacherId, days));

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("teacher_scorecard", { p_teacher_id: teacherId, p_days: days });
  if (error) throw new Error(error.message);
  return scorecardFromRpc(data);
}
