// ============================================================================
// Domain types — mirror mv-app's schema and RPCs (docs/INTEGRATION.md). The room
// runs on mv-app's Supabase project: profiles, session_requests, courses and the
// lesson_* tables live there, and everything the room reads comes back from a
// SECURITY DEFINER RPC (my_profile, my_online_lessons, lesson_room_state) so the
// column wall on profiles.email / phone never has to be crossed here.
// ============================================================================

/** profiles.role (enum user_role). */
export type Role = "parent" | "student" | "teacher" | "staff" | "support" | "admin" | "ambassador";

export const ROLES: readonly Role[] = ["parent", "student", "teacher", "staff", "support", "admin", "ambassador"];

/** What rpc room_access / lesson_room_state give a viewer in a lesson room. */
export type Seat = "host" | "learner" | "observer";

/** my_online_lessons also lists a parent's children's lessons, with no seat in the room. */
export type LessonSeat = Seat | "family";

/** The signed-in person: the columns of rpc my_profile() the room needs. Email and
 * phone are deliberately absent — the room never reads them. */
export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  preferred_name: string | null;
  family_id: string | null;
  grade_level: string | null;
  time_zone: string | null;
  avatar_url: string | null;
  approved_at: string | null;
  deactivated_at: string | null;
  report_auto_approve: boolean;
}

/** The name to show for a person: preferred first, full name otherwise. */
export function displayName(p: Pick<Profile, "full_name" | "preferred_name">): string {
  const preferred = (p.preferred_name ?? "").trim();
  if (preferred) return preferred;
  const full = (p.full_name ?? "").trim();
  return full || "Someone";
}

/** First name for greetings. */
export function firstName(p: Pick<Profile, "full_name" | "preferred_name">): string {
  return displayName(p).split(/\s+/)[0] ?? "";
}

/** session_requests.status. */
export type SessionStatus =
  | "pending"
  | "alternate_proposed"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed";

export type SessionMode = "in_person" | "online";

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  pending: "Pending",
  alternate_proposed: "Alternate proposed",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
};

/** courses (synced from the portal). */
export interface Course {
  id: string;
  name: string;
  department_id: string | null;
  group_name: string | null;
}

/** course_topics — the booking form's option list for a course. */
export interface CourseTopic {
  course_id: string;
  label: string;
  grade_level: string | null;
}

/** One row of rpc my_online_lessons(p_days). */
export interface OnlineLesson {
  session_id: string;
  student_id: string | null;
  student_name: string;
  subject: string | null;
  topic: string | null;
  effective_start: string; // UTC ISO
  ends_at: string | null; // UTC ISO
  duration_minutes: number | null;
  status: SessionStatus;
  mode: SessionMode;
  arrived_at: string | null;
  departed_at: string | null;
  meeting_url: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  report_id: string | null;
  report_status: string | null;
  draft_ready: boolean;
  time_zone: string | null;
  seat: LessonSeat;
}

/** lesson_consents kinds, as the consents jsonb on lesson_room_state carries them. */
export type LessonConsentKind = "recording" | "transcript" | "ai_analysis" | "integrity_camera";

export type RoomConsents = Record<LessonConsentKind, boolean>;

export const NO_CONSENTS: RoomConsents = {
  recording: false,
  transcript: false,
  ai_analysis: false,
  integrity_camera: false,
};

/** One row of rpc lesson_room_state(p_session_id) — none when the viewer has no seat. */
export interface LessonRoomState {
  session_id: string;
  seat: Seat;
  status: SessionStatus;
  mode: SessionMode;
  effective_start: string;
  ends_at: string | null;
  duration_minutes: number | null;
  time_zone: string | null;
  topic: string | null;
  subject: string | null;
  course_id: string | null;
  course_name: string | null;
  department_id: string | null;
  department_name: string | null;
  student_id: string | null;
  student_name: string;
  student_grade: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  family_id: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  meeting_url: string | null;
  materials_course_id: string | null;
  notebook_id: string | null;
  room_opened_at: string | null;
  room_closed_at: string | null;
  recording_enabled: boolean;
  consents: RoomConsents;
}

// ============================================================================
// LEGACY — online-lms shapes that the integration retires. The pages that read
// them (homework, reports, follow-ups) still compile behind the data layer; the
// next stage ports them onto session_reports, lesson_report_drafts,
// lesson_followups and homework_submissions, or removes them.
// ============================================================================

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
  student: { id: string; name: string; avatar_url: string | null };
  parent: { id: string; name: string } | null;
}

export const FOLLOWUP_LABEL: Record<FollowupType, string> = {
  attendance_gap: "Attendance gap",
  no_show: "No-show",
  report_flag: "Report flagged",
  low_rating: "Low rating",
  homework_overdue: "Homework overdue",
};
