import { DateTime } from "luxon";
import type {
  Consent,
  Course,
  CreditBalance,
  Profile,
  Report,
  SessionView,
  TeacherAvailability,
} from "@/lib/types";

// ============================================================================
// Demo dataset — mirrors supabase/seed.sql so the app is fully explorable
// without a Supabase project. Sessions are anchored to "now" so the daily
// board is always populated. Used only when isDemoMode is true.
// ============================================================================

export const demoProfiles: Profile[] = [
  p("00000000-0000-0000-0000-000000000001", "admin", "Admin Office", "admin@lessons.dev", "Asia/Singapore"),
  p("00000000-0000-0000-0000-0000000000a1", "teacher", "Maya Chen", "maya@lessons.dev", "Asia/Singapore"),
  p("00000000-0000-0000-0000-0000000000a2", "teacher", "Daniel Okafor", "daniel@lessons.dev", "Europe/London"),
  p("00000000-0000-0000-0000-0000000000b1", "student", "Aarav Sharma", "aarav@lessons.dev", "Asia/Singapore"),
  p("00000000-0000-0000-0000-0000000000b2", "student", "Sofia Rossi", "sofia@lessons.dev", "America/New_York"),
  p("00000000-0000-0000-0000-0000000000b3", "student", "Lena Park", "lena@lessons.dev", "Asia/Seoul"),
  p("00000000-0000-0000-0000-0000000000c1", "parent", "Priya Sharma", "priya@lessons.dev", "Asia/Singapore", "+6591234567"),
  p("00000000-0000-0000-0000-0000000000c2", "parent", "Marco Rossi", "marco@lessons.dev", "America/New_York", "+13475550123"),
];

export const demoParentStudent: Record<string, string[]> = {
  "00000000-0000-0000-0000-0000000000c1": ["00000000-0000-0000-0000-0000000000b1"],
  "00000000-0000-0000-0000-0000000000c2": ["00000000-0000-0000-0000-0000000000b2"],
};

export const demoCourses: Course[] = [
  c("10000000-0000-0000-0000-000000000001", "IGCSE Mathematics", "Mathematics", "aaaa0000-0000-0000-0000-000000000001"),
  c("10000000-0000-0000-0000-000000000002", "SAT Math Prep", "Mathematics", "aaaa0000-0000-0000-0000-000000000002"),
  c("10000000-0000-0000-0000-000000000003", "A-Level Physics", "Physics", "aaaa0000-0000-0000-0000-000000000003"),
];

export const demoTeacherCourse: Record<string, string[]> = {
  "00000000-0000-0000-0000-0000000000a1": [
    "10000000-0000-0000-0000-000000000001",
    "10000000-0000-0000-0000-000000000002",
  ],
  "00000000-0000-0000-0000-0000000000a2": [
    "10000000-0000-0000-0000-000000000003",
    "10000000-0000-0000-0000-000000000001",
  ],
};

export const demoAvailability: TeacherAvailability[] = [
  av("00000000-0000-0000-0000-0000000000a1", 1, "09:00", "17:00", "Asia/Singapore"),
  av("00000000-0000-0000-0000-0000000000a1", 2, "09:00", "17:00", "Asia/Singapore"),
  av("00000000-0000-0000-0000-0000000000a1", 3, "09:00", "17:00", "Asia/Singapore"),
  av("00000000-0000-0000-0000-0000000000a1", 4, "09:00", "17:00", "Asia/Singapore"),
  av("00000000-0000-0000-0000-0000000000a1", 5, "09:00", "13:00", "Asia/Singapore"),
  av("00000000-0000-0000-0000-0000000000a2", 1, "08:00", "16:00", "Europe/London"),
  av("00000000-0000-0000-0000-0000000000a2", 3, "08:00", "16:00", "Europe/London"),
  av("00000000-0000-0000-0000-0000000000a2", 5, "08:00", "16:00", "Europe/London"),
];

export const demoConsents: Consent[] = [
  { profile_id: "00000000-0000-0000-0000-0000000000b1", type: "recording", granted_by: "00000000-0000-0000-0000-0000000000c1", granted_at: nowISO() },
  { profile_id: "00000000-0000-0000-0000-0000000000b1", type: "ai_analysis", granted_by: "00000000-0000-0000-0000-0000000000c1", granted_at: nowISO() },
  { profile_id: "00000000-0000-0000-0000-0000000000b2", type: "recording", granted_by: "00000000-0000-0000-0000-0000000000c2", granted_at: nowISO() },
  { profile_id: "00000000-0000-0000-0000-0000000000a1", type: "teacher_eval", granted_by: "00000000-0000-0000-0000-0000000000a1", granted_at: nowISO() },
];

export const demoBalances: CreditBalance[] = [
  { student_id: "00000000-0000-0000-0000-0000000000b1", balance: 8, updated_at: nowISO() },
  { student_id: "00000000-0000-0000-0000-0000000000b2", balance: 2, updated_at: nowISO() },
  { student_id: "00000000-0000-0000-0000-0000000000b3", balance: 12, updated_at: nowISO() },
];

/** Sessions are rebuilt on each read so they stay anchored to the current day. */
export function buildDemoSessions(): SessionView[] {
  const now = DateTime.utc();
  const sgt = "Asia/Singapore";
  const nineAmTodaySGT = DateTime.now().setZone(sgt).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

  return [
    sv("20000000-0000-0000-0000-000000000001", 0, 1, "b1", "a1",
       nineAmTodaySGT.toUTC().toISO()!, nineAmTodaySGT.plus({ hours: 1 }).toUTC().toISO()!,
       "completed", "room-aarav-001", "Quadratic equations — completing the square"),
    sv("20000000-0000-0000-0000-000000000002", 1, 1, "b2", "a1",
       now.minus({ minutes: 10 }).toISO()!, now.plus({ minutes: 50 }).toISO()!,
       "in_progress", "room-sofia-002", "SAT Math — function transformations"),
    sv("20000000-0000-0000-0000-000000000003", 2, 2, "b3", "a2",
       now.plus({ hours: 2 }).toISO()!, now.plus({ hours: 3 }).toISO()!,
       "confirmed", "room-lena-003", "Newtonian mechanics — momentum"),
    sv("20000000-0000-0000-0000-000000000004", 2, 2, "b1", null,
       now.plus({ hours: 4 }).toISO()!, now.plus({ hours: 5 }).toISO()!,
       "scheduled", null, "Physics — circular motion intro"),
    sv("20000000-0000-0000-0000-000000000005", 0, 0, "b1", "a2",
       now.minus({ hours: 3 }).toISO()!, now.minus({ hours: 2 }).toISO()!,
       "no_show", "room-aarav-005", "Trigonometry — sine rule"),
    sv("20000000-0000-0000-0000-000000000010", 1, 1, "b2", "a1",
       now.plus({ days: 7 }).toISO()!, now.plus({ days: 7, hours: 1 }).toISO()!,
       "scheduled", null, "SAT Math — weekly slot", "30000000-0000-0000-0000-000000000001"),
    // A completed lesson yesterday with no report yet — so the teacher's report
    // queue has something to write.
    sv("20000000-0000-0000-0000-000000000006", 0, 0, "b1", "a1",
       now.minus({ days: 1, hours: 2 }).toISO()!, now.minus({ days: 1, hours: 1 }).toISO()!,
       "completed", "room-aarav-006", "Quadratics — the quadratic formula"),
  ];
}

export const demoReports: Report[] = [
  {
    session_id: "20000000-0000-0000-0000-000000000001",
    teacher_id: "00000000-0000-0000-0000-0000000000a1",
    topics_covered: "Completing the square; vertex form of a parabola.",
    how_student_did: "Aarav worked through 6 problems and reached vertex form independently by the end.",
    strengths: "Strong algebraic manipulation; asked good clarifying questions.",
    areas_to_work: "Sign errors when the coefficient of x² is not 1 — worth more practice.",
    homework: "Exercise 4B questions 1–8.",
    rating: 4,
    teacher_notes: "Worked through 6 problems; strong on the algebra, careless with signs.",
    ai_drafted: true,
    needs_followup: false,
    followup_reason: null,
    published_at: DateTime.utc().minus({ hours: 1 }).toISO(),
  },
];

// --- tiny builders -----------------------------------------------------------

function nowISO() {
  return DateTime.utc().toISO()!;
}

function p(
  id: string,
  role: Profile["role"],
  name: string,
  email: string,
  tz: string,
  phone: string | null = null,
): Profile {
  return { id, role, display_name: name, email, phone, avatar_url: null, timezone: tz, created_at: nowISO() };
}

function c(id: string, name: string, subject: string, materials: string): Course {
  return { id, name, subject, materials_course_id: materials, created_at: nowISO() };
}

function av(teacher_id: string, weekday: number, start_time: string, end_time: string, timezone: string): TeacherAvailability {
  return { id: `${teacher_id}-${weekday}`, teacher_id, weekday, start_time, end_time, timezone };
}

const SHORT_TO_ID: Record<string, string> = {
  a1: "00000000-0000-0000-0000-0000000000a1",
  a2: "00000000-0000-0000-0000-0000000000a2",
  b1: "00000000-0000-0000-0000-0000000000b1",
  b2: "00000000-0000-0000-0000-0000000000b2",
  b3: "00000000-0000-0000-0000-0000000000b3",
};

function profileLite(short: string) {
  const prof = demoProfiles.find((x) => x.id === SHORT_TO_ID[short])!;
  return { id: prof.id, display_name: prof.display_name, timezone: prof.timezone, avatar_url: prof.avatar_url };
}

function sv(
  id: string,
  courseIdx: number,
  _unused: number,
  studentShort: string,
  teacherShort: string | null,
  start: string,
  end: string,
  status: SessionView["status"],
  room: string | null,
  agenda: string,
  series_id: string | null = null,
): SessionView {
  const course = demoCourses[courseIdx];
  const student = profileLite(studentShort);
  const teacher = teacherShort ? profileLite(teacherShort) : null;
  return {
    id,
    course_id: course.id,
    student_id: student.id,
    teacher_id: teacher?.id ?? null,
    scheduled_start: start,
    scheduled_end: end,
    actual_start: null,
    actual_end: null,
    status,
    video_room_id: room,
    recording_url: null,
    notebook_id: `nb-${studentShort}-${course.id}`,
    series_id,
    agenda,
    cancel_reason: null,
    created_at: nowISO(),
    course: { id: course.id, name: course.name, subject: course.subject, materials_course_id: course.materials_course_id },
    student,
    teacher,
  };
}
