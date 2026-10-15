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
  /** Families default opted-in to WhatsApp notifications (0012). */
  whatsapp_opt_in: boolean;
  created_at: string;
}

export interface Course {
  id: string;
  name: string;
  subject: string | null;
  materials_course_id: string | null;
  created_at: string;
}

/** Post-session pipeline state for a lesson (0017; driven from Phase 2). */
export type AnalysisStatus =
  | "none"
  | "pending"
  | "done"
  | "skipped_opt_out"
  | "no_recording"
  | "failed";

export interface Session {
  id: string;
  course_id: string;
  student_id: string;
  teacher_id: string | null;
  scheduled_start: string; // UTC ISO
  scheduled_end: string; // UTC ISO
  actual_start: string | null; // set when both join (UTC ISO)
  actual_end: string | null; // set when the lesson is ended
  status: SessionStatus;
  /** @deprecated Daily room id — unused since the Pencil Spaces room (0017). */
  video_room_id: string | null;
  recording_url: string | null;
  /** @deprecated tldraw notebook — lesson side retired in 0017; homework keeps it until 0019/0020. */
  notebook_id: string | null;
  series_id: string | null;
  agenda: string | null;
  cancel_reason: string | null;
  /** The Pencil Space (pencil_spaces.id) this lesson ran in; set lazily on first join. */
  space_id: string | null;
  /** Pencil's analytics session id, bound by the End button / pipeline. NOT unique. */
  pencil_session_id: string | null;
  analysis_status: AnalysisStatus;
  /** Admin per-session override of the outage fallback link (any https URL). */
  fallback_join_url: string | null;
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

export type HomeworkStatus = "assigned" | "submitted" | "completed" | "incomplete";

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
  notebook_id: string | null;
  notebook_page_id: string | null;
  submitted_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_note: string | null;
  mark_correct: number | null;
  mark_incorrect: number | null;
  mark_not_done: number | null;
  feedback: string | null;
  attachments: HomeworkAttachment[];
  updated_at: string;
}

export interface HomeworkAttachment {
  name: string;
  path: string;
  size: number;
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

// ---------------------------------------------------------------------------
// Pencil Spaces (0017) — service-only tables, read with the admin client after
// an explicit authorization check (see src/lib/pencil/authz.ts).
// ---------------------------------------------------------------------------

/** Our profile ↔ Pencil API user mapping (pencil_users). */
export interface PencilUser {
  profile_id: string;
  /** Pencil's 24-hex user id (`mock-user-<profile id>` in mock mode). */
  pencil_user_id: string;
  pencil_email: string | null;
  /** What we sent to Pencil: first name (students) / display_name (staff). */
  pencil_name: string | null;
  created_at: string;
}

export type PencilSpaceStatus = "active" | "archived" | "mock";

/** One persistent Pencil Space per (student, course) (pencil_spaces). */
export interface PencilSpace {
  id: string;
  student_id: string;
  course_id: string;
  /** `'<course_id>:<student_id>'` — also sent to Pencil as the Space externalId. */
  external_id: string;
  /** Pencil's 24-hex Space id; null only when status === 'mock'. */
  pencil_space_id: string | null;
  /** The Space URL from spaces/create (`https://my.pencilapp.com/spaces/<id>`). */
  link: string | null;
  title: string | null;
  host_profile_ids: string[];
  participant_profile_ids: string[];
  hosts_synced_at: string | null;
  /** True only after PATCH settings + a confirming GET read-back. */
  recording_disabled: boolean;
  recording_verified_at: string | null;
  status: PencilSpaceStatus;
  created_at: string;
  updated_at: string;
}

/** Recording is OPT-OUT: a row's presence means "do not record" (recording_opt_outs). */
export interface RecordingOptOut {
  student_id: string;
  set_by: string | null;
  set_at: string;
  note: string | null;
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "Live now",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};
