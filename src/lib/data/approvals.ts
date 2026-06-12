import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { dayWindowUTC } from "@/lib/time";

export interface AdminActionItems {
  accountRequests: number;
  enrollmentRequests: number;
  unassignedSessions: number; // upcoming lessons with no teacher
  openFollowups: number;
  totalActions: number;
  sessionsToday: number; // non-cancelled lessons on today's calendar (admin tz)
  sessionsUpcoming: number; // all active lessons from now onwards
}

const EMPTY: AdminActionItems = {
  accountRequests: 0,
  enrollmentRequests: 0,
  unassignedSessions: 0,
  openFollowups: 0,
  totalActions: 0,
  sessionsToday: 0,
  sessionsUpcoming: 0,
};

const ACTIVE = ["scheduled", "confirmed", "in_progress"];

/** Everything waiting on an admin, plus headline session counts (RLS: admin). */
export async function getAdminActionItems(tz: string): Promise<AdminActionItems> {
  if (isDemoMode) return EMPTY;

  const supabase = createSupabaseServerClient();
  if (!supabase) return EMPTY;

  const nowISO = new Date().toISOString();
  const { startUTC, endUTC } = dayWindowUTC(tz);

  const [accounts, enrollments, unassigned, followups, today, upcoming] = await Promise.all([
    supabase.from("account_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("enrollment_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .is("teacher_id", null)
      .in("status", ACTIVE)
      .gte("scheduled_start", nowISO),
    supabase.from("followups").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .neq("status", "cancelled")
      .gte("scheduled_start", startUTC)
      .lt("scheduled_start", endUTC),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .in("status", ACTIVE)
      .gte("scheduled_start", nowISO),
  ]);

  const accountRequests = accounts.count ?? 0;
  const enrollmentRequests = enrollments.count ?? 0;
  const unassignedSessions = unassigned.count ?? 0;
  const openFollowups = followups.count ?? 0;

  return {
    accountRequests,
    enrollmentRequests,
    unassignedSessions,
    openFollowups,
    totalActions: accountRequests + enrollmentRequests + unassignedSessions + openFollowups,
    sessionsToday: today.count ?? 0,
    sessionsUpcoming: upcoming.count ?? 0,
  };
}
