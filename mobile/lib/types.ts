export type Role = "admin" | "teacher" | "student" | "parent";

export interface Profile {
  id: string;
  role: Role;
  display_name: string;
  email: string | null;
  phone: string | null;
  timezone: string;
  avatar_url: string | null;
  whatsapp_opt_in?: boolean;
}

// Embeds come back loosely typed from PostgREST; these views keep screens tidy.
export interface SessionRow {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  agenda: string | null;
  student?: { display_name: string } | null;
  teacher?: { display_name: string } | null;
  course?: { name: string; subject?: string | null } | null;
}

export interface ReportRow {
  id: string;
  session_id: string;
  topics_covered: string | null;
  how_student_did: string | null;
  strengths: string | null;
  areas_to_work: string | null;
  homework: string | null;
  rating: number | null;
  published_at: string | null;
  created_at: string;
  session?: {
    scheduled_start: string;
    course?: { name: string } | null;
    student?: { display_name: string } | null;
  } | null;
}

export interface HomeworkRow {
  id: string;
  description: string;
  status: string;
  due_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  mark_correct: number | null;
  mark_incorrect: number | null;
  mark_not_done: number | null;
  feedback: string | null;
  student_id: string;
  course?: { name: string } | null;
  student?: { display_name: string } | null;
}

export interface FollowupRow {
  id: string;
  type: string;
  priority: string;
  status: string;
  reason: string | null;
  created_at: string;
  student?: { display_name: string } | null;
}

export interface CourseRow {
  id: string;
  name: string;
  subject: string | null;
}

export interface ChildRow {
  id: string;
  display_name: string;
}
