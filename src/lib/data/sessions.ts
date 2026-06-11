import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessions, demoParentStudent } from "@/lib/demo/data";
import { dayWindowUTC } from "@/lib/time";
import type { Profile, SessionView } from "@/lib/types";

const SELECT = `
  *,
  course:courses(id,name,subject,materials_course_id),
  student:profiles!student_id(id,display_name,timezone,avatar_url),
  teacher:profiles!teacher_id(id,display_name,timezone,avatar_url)
`;

/** All sessions falling within a calendar day in `tz` (admin daily board). */
export async function getSessionsForDay(tz: string, dayISO?: string): Promise<SessionView[]> {
  const { startUTC, endUTC } = dayWindowUTC(tz, dayISO);

  if (isDemoMode) {
    return buildDemoSessions()
      .filter((s) => s.scheduled_start >= startUTC && s.scheduled_start < endUTC)
      .sort(byStart);
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("sessions")
    .select(SELECT)
    .gte("scheduled_start", startUTC)
    .lt("scheduled_start", endUTC)
    .order("scheduled_start");
  if (error) throw error;
  return (data ?? []) as unknown as SessionView[];
}

/** Today's sessions for a teacher, in their own timezone. */
export async function getTeacherToday(profile: Profile): Promise<SessionView[]> {
  if (isDemoMode) {
    const { startUTC, endUTC } = dayWindowUTC(profile.timezone);
    return buildDemoSessions()
      .filter((s) => s.teacher_id === profile.id && s.scheduled_start >= startUTC && s.scheduled_start < endUTC)
      .sort(byStart);
  }

  const { startUTC, endUTC } = dayWindowUTC(profile.timezone);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("sessions")
    .select(SELECT)
    .eq("teacher_id", profile.id)
    .gte("scheduled_start", startUTC)
    .lt("scheduled_start", endUTC)
    .order("scheduled_start");
  if (error) throw error;
  return (data ?? []) as unknown as SessionView[];
}

/** Upcoming sessions visible to a profile (RLS scopes real queries). */
export async function getUpcomingForProfile(profile: Profile, limit = 10): Promise<SessionView[]> {
  const nowISO = new Date().toISOString();

  if (isDemoMode) {
    return buildDemoSessions()
      .filter((s) => scopedToProfile(s, profile) && s.scheduled_end >= nowISO && s.status !== "cancelled")
      .sort(byStart)
      .slice(0, limit);
  }

  const supabase = createSupabaseServerClient()!;
  let q = supabase
    .from("sessions")
    .select(SELECT)
    .gte("scheduled_end", nowISO)
    .neq("status", "cancelled")
    .order("scheduled_start")
    .limit(limit);

  // RLS already scopes by viewer; an explicit filter for students keeps it tight.
  if (profile.role === "student") q = q.eq("student_id", profile.id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as SessionView[];
}

/** Past sessions visible to a profile (for "rewatch" / reports lists). */
export async function getPastForProfile(profile: Profile, limit = 20): Promise<SessionView[]> {
  const nowISO = new Date().toISOString();

  if (isDemoMode) {
    return buildDemoSessions()
      .filter((s) => scopedToProfile(s, profile) && s.scheduled_end < nowISO)
      .sort((a, b) => (a.scheduled_start < b.scheduled_start ? 1 : -1))
      .slice(0, limit);
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("sessions")
    .select(SELECT)
    .lt("scheduled_end", nowISO)
    .order("scheduled_start", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as SessionView[];
}

export async function getSessionById(id: string): Promise<SessionView | null> {
  if (isDemoMode) {
    return buildDemoSessions().find((s) => s.id === id) ?? null;
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("sessions").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as SessionView) ?? null;
}

// --- helpers ----------------------------------------------------------------

function byStart(a: SessionView, b: SessionView) {
  return a.scheduled_start < b.scheduled_start ? -1 : 1;
}

/** Demo-only relationship scoping (RLS does this for real queries). */
function scopedToProfile(s: SessionView, profile: Profile): boolean {
  switch (profile.role) {
    case "admin":
      return true;
    case "teacher":
      return s.teacher_id === profile.id;
    case "student":
      return s.student_id === profile.id;
    case "parent":
      return (demoParentStudent[profile.id] ?? []).includes(s.student_id);
  }
}
