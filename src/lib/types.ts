// ============================================================================
// Domain types — mirror the Supabase schema (supabase/migrations).
// ============================================================================

export type Role = "admin" | "teacher" | "student" | "parent";

export type SessionStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type ConsentType = "recording" | "ai_analysis" | "teacher_eval";

export interface Profile {
  id: string;
  role: Role;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
}

export interface Course {
  id: string;
  name: string;
  subject: string | null;
  materials_course_id: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  course_id: string;
  student_id: string;
  teacher_id: string | null;
  scheduled_start: string; // UTC ISO
  scheduled_end: string; // UTC ISO
  status: SessionStatus;
  video_room_id: string | null;
  recording_url: string | null;
  notebook_id: string | null;
  series_id: string | null;
  agenda: string | null;
  cancel_reason: string | null;
  created_at: string;
}

/** A session joined with the names it needs to render. */
export interface SessionView extends Session {
  course: Pick<Course, "id" | "name" | "subject" | "materials_course_id">;
  student: Pick<Profile, "id" | "display_name" | "timezone" | "avatar_url">;
  teacher: Pick<Profile, "id" | "display_name" | "timezone" | "avatar_url"> | null;
}

export interface TeacherAvailability {
  id: string;
  teacher_id: string;
  weekday: number; // 0 Sun .. 6 Sat
  start_time: string;
  end_time: string;
  timezone: string;
}

export interface Report {
  session_id: string;
  teacher_id: string | null;
  topics_covered: string | null;
  how_student_did: string | null;
  strengths: string | null;
  areas_to_work: string | null;
  homework: string | null;
  rating: number | null;
  published_at: string | null;
}

export interface Consent {
  profile_id: string;
  type: ConsentType;
  granted_by: string | null;
  granted_at: string;
}

export interface CreditBalance {
  student_id: string;
  balance: number;
  updated_at: string;
}

export interface Notification {
  id: string;
  profile_id: string;
  type: string;
  title: string;
  body: string | null;
  session_id: string | null;
  read_at: string | null;
  created_at: string;
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "Live now",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};
