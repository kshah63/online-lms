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
// Reports, drafts, follow-ups and coaching — mv-app's own tables, read under
// RLS. Nothing here is written by the room except through submit_report.
// ============================================================================

/** session_reports.status (enum report_status). */
export type ReportStatus = "pending" | "published" | "rejected";

/** A session_reports row, as the family and the teacher may read it under RLS. */
export interface SessionReport {
  id: string;
  session_request_id: string | null;
  student_id: string | null;
  status: ReportStatus;
  course_name: string | null;
  topic: string | null;
  topic_completed: boolean | null;
  topics_not_done: string | null;
  understanding: number | null;
  otr: number | null;
  gp: number | null;
  prev_hw: string | null;
  homework: string | null;
  remarks: string | null;
  written_tests: { name: string; score: number | null; out_of: number | null; percent: number | null }[];
  has_upcoming_tests: boolean;
  published_at: string | null;
  created_at: string;
}

/** The columns of session_reports the room selects (never `*`). */
export const SESSION_REPORT_COLUMNS =
  "id, session_request_id, student_id, status, course_name, topic, topic_completed, topics_not_done, understanding, otr, gp, prev_hw, homework, remarks, written_tests, has_upcoming_tests, published_at, created_at";

/** A lesson_report_drafts row: the AI draft in submit_report's vocabulary, written by lesson-finalize. */
export interface ReportDraftRow {
  session_id: string;
  draft: Record<string, unknown>;
  rationale: string | null;
  source: "ai" | "heuristic";
  created_at: string;
  used_at: string | null;
}

export type FollowupKind = "win" | "concern" | "misconception" | "logistics" | "exam_upcoming" | "ask_to_relay" | "tech_issue";
export type FollowupAction = "share_with_parent" | "staff_task" | "note_for_next_lesson" | "staff_call";
export type FollowupStatus = "proposed" | "approved" | "dismissed" | "done";

/** A lesson_followups row, proposed from the transcript and decided in the centre app. */
export interface LessonFollowup {
  id: string;
  session_id: string;
  student_id: string;
  family_id: string | null;
  department_id: string | null;
  kind: FollowupKind;
  action: FollowupAction;
  priority: string;
  title: string;
  detail: string | null;
  quote: string | null;
  at_ms: number | null;
  suggested_parent_message: string | null;
  status: FollowupStatus;
  decided_at: string | null;
  created_at: string;
}

export const LESSON_FOLLOWUP_COLUMNS =
  "id, session_id, student_id, family_id, department_id, kind, action, priority, title, detail, quote, at_ms, suggested_parent_message, status, decided_at, created_at";

export const FOLLOWUP_KIND_LABEL: Record<FollowupKind, string> = {
  win: "Win to share",
  concern: "Concern",
  misconception: "Misconception",
  logistics: "Logistics",
  exam_upcoming: "Exam coming up",
  ask_to_relay: "Asked to relay",
  tech_issue: "Tech issue",
};

export const FOLLOWUP_ACTION_LABEL: Record<FollowupAction, string> = {
  share_with_parent: "Share with the parent",
  staff_task: "Staff task",
  note_for_next_lesson: "Note for next lesson",
  staff_call: "Staff call",
};

/** A lesson_metrics row, computed by lesson-finalize from the transcript. */
export interface LessonMetricsRow {
  session_id: string;
  teacher_talk_pct: number;
  student_talk_pct: number;
  question_count: number;
  open_question_pct: number;
  avg_wait_ms: number;
  student_turns: number;
  praise_count: number;
  computed_at: string;
}

/** A lesson_feedback row: the post-session coaching for the teacher. */
export interface LessonFeedbackRow {
  session_id: string;
  summary: string;
  strengths: string[];
  suggestions: string[];
  dimension_scores: { engagement: number; questioning: number; clarity: number; rapport: number };
  moments: { at: string; kind: "strength" | "improvement"; quote: string; comment: string }[];
  created_at: string;
}

export const LESSON_FEEDBACK_COLUMNS = "session_id, summary, strengths, suggestions, dimension_scores, moments, created_at";
