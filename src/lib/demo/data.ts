import { DateTime } from "luxon";
import { roomIsOpen } from "@/lib/lessons/window";
import type {
  Course,
  CourseTopic,
  LessonFollowup,
  LessonRoomState,
  LessonSeat,
  OnlineLesson,
  Profile,
  ReportDraftRow,
  Role,
  RoomConsents,
  Seat,
  SessionReport,
  SessionStatus,
} from "@/lib/types";
import { displayName, NO_CONSENTS } from "@/lib/types";

// ============================================================================
// Demo dataset — mv-app's shapes (profiles with mv roles and a family_id,
// families, departments, courses, course_topics, session_requests) so the app is
// explorable without a Supabase project. Sessions are anchored to "now" so a
// lesson is always live. Used only when isDemoMode is true.
//
// Ids are stable: the demo teacher is ...a1, students ...b1/...b2, parent ...c1,
// admin ...01, so existing scripts keep working. staff is ...d1, support ...d2.
// ============================================================================

export const CENTRE_TZ = "Asia/Singapore";

const ID = {
  admin: "00000000-0000-0000-0000-000000000001",
  maya: "00000000-0000-0000-0000-0000000000a1",
  daniel: "00000000-0000-0000-0000-0000000000a2",
  aarav: "00000000-0000-0000-0000-0000000000b1",
  sofia: "00000000-0000-0000-0000-0000000000b2",
  lena: "00000000-0000-0000-0000-0000000000b3",
  priya: "00000000-0000-0000-0000-0000000000c1",
  marco: "00000000-0000-0000-0000-0000000000c2",
  grace: "00000000-0000-0000-0000-0000000000d1",
  ravi: "00000000-0000-0000-0000-0000000000d2",
} as const;

export const DEMO_IDS = ID;

export const demoFamilies = [
  { id: "f0000000-0000-0000-0000-000000000001", name: "Sharma", student_names: ["Aarav"] },
  { id: "f0000000-0000-0000-0000-000000000002", name: "Rossi", student_names: ["Sofia"] },
  { id: "f0000000-0000-0000-0000-000000000003", name: "Park", student_names: ["Lena"] },
];

export const demoDepartments = [
  { id: "d0000000-0000-0000-0000-000000000001", name: "Online Mathematics" },
  { id: "d0000000-0000-0000-0000-000000000002", name: "Online Physics" },
];

const [SHARMA, ROSSI, PARK] = demoFamilies;
const [MATHS, PHYSICS] = demoDepartments;

export const demoProfiles: Profile[] = [
  p(ID.admin, "admin", "Admin Office", null, null, CENTRE_TZ),
  p(ID.grace, "staff", "Grace Lim", null, null, CENTRE_TZ),
  p(ID.ravi, "support", "Ravi Menon", null, null, CENTRE_TZ),
  p(ID.maya, "teacher", "Maya Chen", null, null, CENTRE_TZ),
  p(ID.daniel, "teacher", "Daniel Okafor", null, null, "Europe/London"),
  p(ID.aarav, "student", "Aarav Sharma", SHARMA.id, "Sec 3", CENTRE_TZ),
  p(ID.sofia, "student", "Sofia Rossi", ROSSI.id, "Grade 11", "America/New_York"),
  p(ID.lena, "student", "Lena Park", PARK.id, "JC 1", "Asia/Seoul"),
  p(ID.priya, "parent", "Priya Sharma", SHARMA.id, null, CENTRE_TZ),
  p(ID.marco, "parent", "Marco Rossi", ROSSI.id, null, "America/New_York"),
];

/** The in-charge's room: staff ...d1 is in charge of Online Mathematics. */
export const demoInchargeDepartments: Record<string, string[]> = {
  [ID.grace]: [MATHS.id],
};

export const demoCourses: Course[] = [
  { id: "10000000-0000-0000-0000-000000000001", name: "IGCSE Mathematics", department_id: MATHS.id, group_name: "Secondary" },
  { id: "10000000-0000-0000-0000-000000000002", name: "SAT Math Prep", department_id: MATHS.id, group_name: "Test prep" },
  { id: "10000000-0000-0000-0000-000000000003", name: "A-Level Physics", department_id: PHYSICS.id, group_name: "Pre-university" },
];

const [IGCSE, SAT, PHYS] = demoCourses;

export const demoCourseTopics: CourseTopic[] = [
  { course_id: IGCSE.id, label: "Quadratic equations", grade_level: "Sec 3" },
  { course_id: IGCSE.id, label: "Completing the square", grade_level: "Sec 3" },
  { course_id: IGCSE.id, label: "Trigonometry — sine rule", grade_level: "Sec 3" },
  { course_id: IGCSE.id, label: "Functions and graphs", grade_level: "Sec 4" },
  { course_id: SAT.id, label: "Function transformations", grade_level: null },
  { course_id: SAT.id, label: "Linear systems", grade_level: null },
  { course_id: PHYS.id, label: "Newtonian mechanics — momentum", grade_level: "JC 1" },
  { course_id: PHYS.id, label: "Circular motion", grade_level: "JC 1" },
];

/** lesson_course_materials: course → the materials portal's course id. */
export const demoCourseMaterials: Record<string, string> = {
  [IGCSE.id]: "aaaa0000-0000-0000-0000-000000000001",
  [SAT.id]: "aaaa0000-0000-0000-0000-000000000002",
  [PHYS.id]: "aaaa0000-0000-0000-0000-000000000003",
};

/** lesson_consents, per student (granted_by the parent). */
export const demoConsents: Record<string, RoomConsents> = {
  [ID.aarav]: { recording: true, transcript: true, ai_analysis: true, integrity_camera: false },
  [ID.sofia]: { recording: true, transcript: true, ai_analysis: true, integrity_camera: true },
  [ID.lena]: { ...NO_CONSENTS, transcript: true, ai_analysis: true },
};

/** A session_requests row (the columns the room reads), mode online. */
export interface DemoSessionRequest {
  id: string;
  family_id: string | null;
  student_id: string;
  student_name: string;
  subject: string;
  topic: string | null;
  mode: "online";
  effective_start: string;
  ends_at: string;
  duration_minutes: number;
  status: SessionStatus;
  department_id: string;
  assigned_teacher_id: string | null;
  course_id: string;
  meeting_url: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  time_zone: string;
}

/** Sessions are rebuilt on each read so they stay anchored to the current day. */
export function buildDemoSessionRequests(): DemoSessionRequest[] {
  const now = DateTime.utc();
  const nineAmTodaySGT = DateTime.now().setZone(CENTRE_TZ).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

  return [
    // This morning, done and reported.
    sr("20000000-0000-0000-0000-000000000001", IGCSE, ID.aarav, ID.maya,
      nineAmTodaySGT.toUTC(), 60, "completed", "Quadratic equations — completing the square",
      { arrived_at: nineAmTodaySGT.toUTC().toISO()!, departed_at: nineAmTodaySGT.plus({ minutes: 58 }).toUTC().toISO()! }),
    // Live right now: the lesson the persona picker flow opens.
    sr("20000000-0000-0000-0000-000000000002", SAT, ID.sofia, ID.maya,
      now.minus({ minutes: 10 }), 60, "confirmed", "SAT Math — function transformations"),
    sr("20000000-0000-0000-0000-000000000003", PHYS, ID.lena, ID.daniel,
      now.plus({ hours: 2 }), 60, "confirmed", "Newtonian mechanics — momentum"),
    // Booked, no teacher added yet (staffing is decided in the room on the day).
    sr("20000000-0000-0000-0000-000000000004", PHYS, ID.aarav, null,
      now.plus({ hours: 4 }), 60, "confirmed", "Physics — circular motion intro"),
    // Earlier today, nobody joined.
    sr("20000000-0000-0000-0000-000000000005", IGCSE, ID.aarav, ID.daniel,
      now.minus({ hours: 3 }), 60, "completed", "Trigonometry — sine rule"),
    sr("20000000-0000-0000-0000-000000000010", SAT, ID.sofia, ID.maya,
      now.plus({ days: 7 }), 60, "confirmed", "SAT Math — weekly slot"),
    // Yesterday, completed, no report yet — so the teacher's report queue has work.
    sr("20000000-0000-0000-0000-000000000006", IGCSE, ID.aarav, ID.maya,
      now.minus({ days: 1, hours: 2 }), 60, "completed", "Quadratics — the quadratic formula",
      { arrived_at: now.minus({ days: 1, hours: 2 }).toISO()!, departed_at: now.minus({ days: 1, hours: 1 }).toISO()! }),
    // A week ago, reported — so the brief for the live lesson has a last time.
    sr("20000000-0000-0000-0000-000000000007", SAT, ID.sofia, ID.maya,
      now.minus({ days: 7, minutes: 10 }), 60, "completed", "SAT Math — linear systems",
      { arrived_at: now.minus({ days: 7, minutes: 9 }).toISO()!, departed_at: now.minus({ days: 7 }).plus({ minutes: 49 }).toISO()! }),
  ];
}

// --- the RPCs, as the demo answers them ------------------------------------

/** rpc room_access: the viewer's seat on a session, or null. */
export function demoRoomAccess(viewer: Profile, s: DemoSessionRequest, nowMs = Date.now()): Seat | null {
  const open = roomIsOpen(s, nowMs);
  if (s.assigned_teacher_id === viewer.id && open) return "host";
  if (s.student_id === viewer.id && open) return "learner";
  if (viewer.role === "admin") return "observer";
  if (viewer.role === "staff" && (demoInchargeDepartments[viewer.id] ?? []).includes(s.department_id)) return "observer";
  if (viewer.role === "support") return "observer";
  return null;
}

/** rpc lesson_room_state: one row for the viewer, or null when they have no seat. */
export function buildDemoLessonRoomState(sessionId: string, viewer: Profile, nowMs = Date.now()): LessonRoomState | null {
  const s = buildDemoSessionRequests().find((x) => x.id === sessionId);
  if (!s) return null;
  const seat = demoRoomAccess(viewer, s, nowMs);
  if (!seat) return null;
  const course = demoCourses.find((c) => c.id === s.course_id)!;
  const department = demoDepartments.find((d) => d.id === s.department_id)!;
  const student = demoProfiles.find((x) => x.id === s.student_id)!;
  const teacher = demoProfiles.find((x) => x.id === s.assigned_teacher_id) ?? null;
  return {
    session_id: s.id,
    seat,
    status: s.status,
    mode: s.mode,
    effective_start: s.effective_start,
    ends_at: s.ends_at,
    duration_minutes: s.duration_minutes,
    time_zone: s.time_zone,
    topic: s.topic,
    subject: s.subject,
    course_id: course.id,
    course_name: course.name,
    department_id: department.id,
    department_name: department.name,
    student_id: s.student_id,
    student_name: s.student_name,
    student_grade: student.grade_level,
    teacher_id: teacher?.id ?? null,
    teacher_name: teacher ? displayName(teacher) : null,
    family_id: s.family_id,
    arrived_at: s.arrived_at,
    departed_at: s.departed_at,
    meeting_url: s.meeting_url,
    materials_course_id: demoCourseMaterials[course.id] ?? null,
    notebook_id: demoNotebookId(s.student_id, course.id),
    room_opened_at: s.arrived_at,
    room_closed_at: s.departed_at,
    recording_enabled: true,
    consents: demoConsents[s.student_id] ?? NO_CONSENTS,
  };
}

/** lesson_notebooks is unique(student_id, course_id): one running notebook per student per course. */
export function demoNotebookId(studentId: string, courseId: string): string {
  const short = Object.entries(ID).find(([, v]) => v === studentId)?.[0] ?? studentId.slice(-2);
  return `nb-${short}-${courseId}`;
}

/** rpc my_online_lessons(p_days): the viewer's online lessons within ±p_days. */
export function buildDemoOnlineLessons(viewer: Profile, days = 14, nowMs = Date.now()): OnlineLesson[] {
  const from = nowMs - days * 86_400_000;
  const to = nowMs + days * 86_400_000;
  const out: OnlineLesson[] = [];
  for (const s of buildDemoSessionRequests()) {
    const start = Date.parse(s.effective_start);
    if (start < from || start > to) continue;
    const seat = demoListingSeat(viewer, s);
    if (!seat) continue;
    const teacher = demoProfiles.find((x) => x.id === s.assigned_teacher_id) ?? null;
    const report = demoSessionReports.find((r) => r.session_request_id === s.id) ?? null;
    out.push({
      session_id: s.id,
      student_id: s.student_id,
      student_name: s.student_name,
      subject: s.subject,
      topic: s.topic,
      effective_start: s.effective_start,
      ends_at: s.ends_at,
      duration_minutes: s.duration_minutes,
      status: s.status,
      mode: s.mode,
      arrived_at: s.arrived_at,
      departed_at: s.departed_at,
      meeting_url: s.meeting_url,
      teacher_id: teacher?.id ?? null,
      teacher_name: teacher ? displayName(teacher) : null,
      report_id: report?.id ?? null,
      report_status: report?.status ?? null,
      draft_ready: !report && s.id in demoReportDrafts,
      time_zone: s.time_zone,
      seat,
    });
  }
  return out.sort((a, b) => a.effective_start.localeCompare(b.effective_start));
}

/** The seat my_online_lessons reports: the listing ignores the time window. */
function demoListingSeat(viewer: Profile, s: DemoSessionRequest): LessonSeat | null {
  if (s.assigned_teacher_id === viewer.id) return "host";
  if (s.student_id === viewer.id) return "learner";
  if (viewer.role === "parent" && viewer.family_id && s.family_id === viewer.family_id) return "family";
  if (viewer.role === "admin" || viewer.role === "support") return "observer";
  if (viewer.role === "staff" && (demoInchargeDepartments[viewer.id] ?? []).includes(s.department_id)) return "observer";
  return null;
}

/** A parent's children: the students in their family. */
export function demoChildren(parent: Profile): Profile[] {
  if (parent.role === "student") return [parent];
  if (parent.role !== "parent" || !parent.family_id) return [];
  return demoProfiles.filter((x) => x.role === "student" && x.family_id === parent.family_id);
}

// --- session_reports, lesson_report_drafts, lesson_followups -----------------

/** session_reports rows (written by submit_report in the app; the family reads published ones). */
export const demoSessionReports: SessionReport[] = [
  {
    id: "30000000-0000-0000-0000-000000000001",
    session_request_id: "20000000-0000-0000-0000-000000000001",
    student_id: ID.aarav,
    status: "published",
    course_name: IGCSE.name,
    topic: "Completing the square",
    topic_completed: true,
    topics_not_done: null,
    understanding: 8,
    otr: null,
    gp: 5.5,
    prev_hw: "Most of it Done",
    homework: "Exercise 4B questions 1–8.",
    remarks:
      "Aarav worked through six problems on completing the square and reached vertex form on his own by the end. His algebra is strong and he asked good questions; sign errors when the x² coefficient is not 1 are the thing to practise.",
    written_tests: [{ name: "Quick check", score: 4, out_of: 5, percent: 80 }],
    has_upcoming_tests: false,
    published_at: DateTime.utc().minus({ hours: 1 }).toISO(),
    created_at: DateTime.utc().minus({ hours: 1, minutes: 5 }).toISO()!,
  },
  {
    id: "30000000-0000-0000-0000-000000000007",
    session_request_id: "20000000-0000-0000-0000-000000000007",
    student_id: ID.sofia,
    status: "published",
    course_name: SAT.name,
    topic: "Linear systems",
    topic_completed: false,
    topics_not_done: "systems with no solution",
    understanding: 6,
    otr: 70,
    gp: 4.75,
    prev_hw: "Yes",
    homework: "Practice set 3, questions 1–10 (substitution and elimination).",
    remarks:
      "Sofia solved linear systems by substitution confidently and is getting faster at elimination. We ran out of time before systems with no solution, so that is where we pick up. A little more speed on the arithmetic would help on the timed sections.",
    written_tests: [],
    has_upcoming_tests: true,
    published_at: DateTime.utc().minus({ days: 6, hours: 20 }).toISO(),
    created_at: DateTime.utc().minus({ days: 6, hours: 22 }).toISO()!,
  },
];

/** lesson_report_drafts: what lesson-finalize drafted for a lesson with no report yet. */
export const demoReportDrafts: Record<string, ReportDraftRow> = {
  "20000000-0000-0000-0000-000000000006": {
    session_id: "20000000-0000-0000-0000-000000000006",
    draft: {
      topic: "Quadratic equations",
      topic_completed: true,
      topics_not_done: null,
      understanding: 7,
      otr: null,
      gp: null,
      prev_hw: "Yes",
      homework: "Quadratic formula worksheet — questions 1–6.",
      remarks:
        "Aarav used the quadratic formula on eight equations today and got seven right. He is careful with the discriminant and spotted when there was no real root. Simplifying surds at the end is the next thing to tidy up.",
      written_tests: [{ name: "Quick check", score: 7, out_of: 8 }],
      has_upcoming_tests: false,
    },
    rationale: "Understanding 7: seven of eight correct with one surd slip. No oral check was scored, so no OTR.",
    source: "ai",
    created_at: DateTime.utc().minus({ days: 1, minutes: 55 }).toISO()!,
    used_at: null,
  },
};

/** lesson_followups: proposed from the transcript; decided in the centre app. */
export const demoFollowups: LessonFollowup[] = [
  fu("40000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000001", ID.aarav, "win", "share_with_parent", "normal",
    "Reached vertex form independently", "Aarav completed the square on his own by the end of the lesson.",
    "I think I've got it now — it's always half the coefficient.", 1_873_000,
    "Aarav reached vertex form on his own today — a real step forward on completing the square.", "proposed", 1),
  fu("40000000-0000-0000-0000-000000000002", "20000000-0000-0000-0000-000000000006", ID.aarav, "misconception", "note_for_next_lesson", "normal",
    "Surds not simplified", "Leaves √12 unsimplified; worth a five-minute recap before the next quadratics lesson.",
    "Is √12 fine as the answer?", 2_410_000, null, "proposed", 1),
  fu("40000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000007", ID.sofia, "exam_upcoming", "staff_task", "high",
    "SAT sitting in three weeks", "Sofia mentioned her SAT date; the office may want to add a timed practice test before then.",
    "My test is on the first Saturday of next month.", 312_000, null, "approved", 6),
  fu("40000000-0000-0000-0000-000000000004", "20000000-0000-0000-0000-000000000007", ID.sofia, "tech_issue", "staff_call", "low",
    "Audio dropped twice", "Sofia's audio cut out twice in the first ten minutes.", null, 540_000, null, "dismissed", 6),
];

// --- tiny builders -----------------------------------------------------------

function p(id: string, role: Role, name: string, family_id: string | null, grade: string | null, tz: string): Profile {
  return {
    id,
    role,
    full_name: name,
    preferred_name: null,
    family_id,
    grade_level: grade,
    time_zone: tz,
    avatar_url: null,
    approved_at: DateTime.utc().minus({ months: 6 }).toISO(),
    deactivated_at: null,
    report_auto_approve: false,
  };
}

function fu(
  id: string,
  sessionId: string,
  studentId: string,
  kind: LessonFollowup["kind"],
  action: LessonFollowup["action"],
  priority: string,
  title: string,
  detail: string,
  quote: string | null,
  atMs: number,
  suggested: string | null,
  status: LessonFollowup["status"],
  ageDays: number,
): LessonFollowup {
  const student = demoProfiles.find((x) => x.id === studentId)!;
  const course = buildDemoSessionRequests().find((s) => s.id === sessionId);
  const decided = status === "proposed" ? null : DateTime.utc().minus({ days: ageDays, hours: -2 }).toISO();
  return {
    id,
    session_id: sessionId,
    student_id: studentId,
    family_id: student.family_id,
    department_id: course?.department_id ?? null,
    kind,
    action,
    priority,
    title,
    detail,
    quote,
    at_ms: atMs,
    suggested_parent_message: suggested,
    status,
    decided_at: decided,
    created_at: DateTime.utc().minus({ days: ageDays, hours: 1 }).toISO()!,
  };
}

function sr(
  id: string,
  course: Course,
  studentId: string,
  teacherId: string | null,
  start: DateTime,
  durationMinutes: number,
  status: SessionStatus,
  topic: string,
  attendance: { arrived_at: string | null; departed_at: string | null } = { arrived_at: null, departed_at: null },
): DemoSessionRequest {
  const student = demoProfiles.find((x) => x.id === studentId)!;
  return {
    id,
    family_id: student.family_id,
    student_id: student.id,
    student_name: displayName(student),
    subject: course.name,
    topic,
    mode: "online",
    effective_start: start.toUTC().toISO()!,
    ends_at: start.plus({ minutes: durationMinutes }).toUTC().toISO()!,
    duration_minutes: durationMinutes,
    status,
    department_id: course.department_id!,
    assigned_teacher_id: teacherId,
    course_id: course.id,
    meeting_url: `/lesson/${id}`,
    arrived_at: attendance.arrived_at,
    departed_at: attendance.departed_at,
    time_zone: CENTRE_TZ,
  };
}
