import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessions } from "@/lib/demo/data";
import type { Profile, Session } from "@/lib/types";

// ============================================================================
// The ONE authorization boundary in front of every Pencil call made with the
// institution API key and every minted join URL. Shared by the lesson page,
// /api/lesson/[id]/space, server actions and the mobile bearer routes. RLS does
// not protect the admin client, so these must run BEFORE provisioning/minting.
// ============================================================================

export type LessonAccessProfile = Pick<Profile, "id" | "role">;
export type LessonAccessSession = Pick<Session, "teacher_id" | "student_id">;

/**
 * May this profile open /lesson/[id] at all? Mirrors the rule in
 * src/app/lesson/[sessionId]/page.tsx exactly:
 *   admin → yes · teacher → only when assigned (session.teacher_id) ·
 *   student → own session · parent → a child's session (childIds from getChildren).
 * NB: a parent passing this check gets the STATUS CARD only — see canEnterSpace.
 */
export function canJoinLesson(
  profile: LessonAccessProfile,
  session: LessonAccessSession,
  childIds: readonly string[],
): boolean {
  switch (profile.role) {
    case "admin":
      return true;
    case "teacher":
      return session.teacher_id !== null && session.teacher_id === profile.id;
    case "student":
      return session.student_id === profile.id;
    case "parent":
      return childIds.includes(session.student_id);
    default:
      return false;
  }
}

/**
 * May this profile hold a Pencil user and receive a join URL for the session?
 * = canJoinLesson AND not a parent (parents have no Pencil user, no seat in the
 * room — owner decision 3). Use this in the Space route; use canJoinLesson for
 * the page itself.
 */
export function canEnterSpace(
  profile: LessonAccessProfile,
  session: LessonAccessSession,
  childIds: readonly string[],
): boolean {
  return profile.role !== "parent" && canJoinLesson(profile, session, childIds);
}

/**
 * May this profile be a HOST of the (student, course) Space — i.e. be added via
 * updateUsers and open the Space outside a specific lesson (homework review)?
 *   admin → yes · teacher → only with at least one non-cancelled session for
 *   exactly that student AND course · everyone else → no.
 * A teacher who passes RLS `teaches_student` for a different course can grade
 * in our app but gets no host seat. Fails CLOSED on a missing client or a
 * query error. `admin` is the service-role client (createSupabaseAdminClient()).
 */
export async function canHostSpace(
  admin: SupabaseClient | null,
  profile: LessonAccessProfile,
  studentId: string,
  courseId: string,
): Promise<boolean> {
  if (profile.role === "admin") return true;
  if (profile.role !== "teacher") return false;

  if (isDemoMode) {
    return buildDemoSessions().some(
      (s) =>
        s.teacher_id === profile.id &&
        s.student_id === studentId &&
        s.course_id === courseId &&
        s.status !== "cancelled",
    );
  }

  if (!admin) return false;
  const { count, error } = await admin
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", profile.id)
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .neq("status", "cancelled");
  if (error) {
    console.error("canHostSpace query failed:", error.message);
    return false; // fail closed
  }
  return (count ?? 0) > 0;
}

/**
 * May this profile end the lesson (completed | no_show)? The assigned teacher
 * or an admin — the same rule `endLesson` must re-apply in its UPDATE filter.
 */
export function canEndLesson(profile: LessonAccessProfile, session: LessonAccessSession): boolean {
  return profile.role === "admin" || (profile.role === "teacher" && session.teacher_id === profile.id);
}
