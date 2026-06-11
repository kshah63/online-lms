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
  phone: string | null;
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
  teacher_notes: string | null;
  ai_drafted: boolean;
  needs_followup: boolean;
  followup_reason: string | null;
  published_at: string | null;
}

export type HomeworkStatus = "assigned" | "completed" | "incomplete";

export interface Homework {
  id: string;
  session_id: string | null;
  student_id: string;
  course_id: string | null;
  description: string;
  assigned_at: string;
  due_at: string | null;
  status: HomeworkStatus;
  completed_at: string | null;
  marked_by: string | null;
  updated_at: string;
}

export type FollowupType =
  | "attendance_gap"
  | "no_show"
  | "report_flag"
  | "low_rating"
  | "homework_overdue";

export type FollowupStatus = "open" | "snoozed" | "done";
export type FollowupPriority = "low" | "normal" | "high";

export interface Followup {
  id: string;
  student_id: string;
  session_id: string | null;
  type: FollowupType;
  priority: FollowupPriority;
  reason: string | null;
  status: FollowupStatus;
  due_at: string | null;
  snoozed_until: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

/** A follow-up joined with the student (and parent) it concerns. */
export interface FollowupView extends Followup {
  student: Pick<Profile, "id" | "display_name" | "timezone" | "avatar_url" | "phone">;
  parent: Pick<Profile, "id" | "display_name" | "phone"> | null;
}

export interface OutboundMessage {
  id: string;
  channel: "whatsapp" | "email";
  to_profile: string | null;
  to_phone: string | null;
  body: string;
  status: "queued" | "sent" | "failed" | "simulated";
  provider_ref: string | null;
  followup_id: string | null;
  sent_by: string | null;
  created_at: string;
}

export const FOLLOWUP_LABEL: Record<FollowupType, string> = {
  attendance_gap: "Attendance gap",
  no_show: "No-show",
  report_flag: "Report flagged",
  low_rating: "Low rating",
  homework_overdue: "Homework overdue",
};

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
