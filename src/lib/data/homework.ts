import { DateTime } from "luxon";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessionRequests, demoChildren, demoCourses, demoNotebookId, demoProfiles } from "@/lib/demo/data";
import { displayName, type Homework, type Profile } from "@/lib/types";

// ============================================================================
// Homework, behind the data layer. online-lms's homework table is retired:
// the centre's homework is session_reports.homework (set by the report), with
// at-home practice as practice_assignments (mode at_home) and notebook or file
// hand-ins as homework_submissions. TODO(next stage): port these readers; the
// live paths return nothing until then, and demo mode keeps its sample rows.
// ============================================================================

export interface HomeworkView extends Homework {
  course_name: string;
  student_name: string;
}

const IGCSE = demoCourses[0];
const SAT = demoCourses[1];

// ---------------------------------------------------------------------------
// Demo homework — linked to the student's running notebook, in a mix of states.
// ---------------------------------------------------------------------------
function demoHomework(): HomeworkView[] {
  const now = DateTime.utc();
  const aarav = "00000000-0000-0000-0000-0000000000b1";
  const sofia = "00000000-0000-0000-0000-0000000000b2";

  const item = (over: Partial<HomeworkView> & { id: string; student_id: string; description: string }): HomeworkView => {
    const student = demoProfiles.find((p) => p.id === over.student_id);
    return {
      session_id: null,
      course_id: IGCSE.id,
      assigned_at: now.minus({ days: 5 }).toISO()!,
      due_at: now.plus({ days: 3 }).toISO()!,
      status: "assigned",
      completed_at: null,
      marked_by: null,
      notebook_id: null,
      notebook_page_id: null,
      submitted_at: null,
      verified_by: null,
      verified_at: null,
      review_note: null,
      mark_correct: null,
      mark_incorrect: null,
      mark_not_done: null,
      feedback: null,
      attachments: [],
      updated_at: now.toISO()!,
      course_name: IGCSE.name,
      student_name: student ? displayName(student) : "Student",
      ...over,
    };
  };

  return [
    item({
      id: "hw-1",
      student_id: aarav,
      description: "Exercise 4B questions 1–8 (completing the square).",
      course_id: IGCSE.id,
      course_name: IGCSE.name,
      notebook_id: demoNotebookId(aarav, IGCSE.id),
      notebook_page_id: "page:hw1",
      status: "completed",
      due_at: now.minus({ days: 1 }).toISO(),
      submitted_at: now.minus({ days: 2 }).toISO(),
      completed_at: now.minus({ days: 1 }).toISO(),
      verified_at: now.minus({ days: 1 }).toISO(),
      mark_correct: 6,
      mark_incorrect: 1,
      mark_not_done: 1,
      feedback: "Strong work — just watch the sign when the x² coefficient isn't 1.",
    }),
    item({
      id: "hw-2",
      student_id: aarav,
      description: "Quadratic formula worksheet — questions 1–6. Show your working on the notebook.",
      course_id: IGCSE.id,
      course_name: IGCSE.name,
      notebook_id: demoNotebookId(aarav, IGCSE.id),
      due_at: now.plus({ days: 3 }).toISO(),
      status: "assigned",
    }),
    item({
      id: "hw-3",
      student_id: sofia,
      description: "Function transformations practice set.",
      course_id: SAT.id,
      course_name: SAT.name,
      notebook_id: demoNotebookId(sofia, SAT.id),
      notebook_page_id: "page:hw3",
      status: "submitted",
      due_at: now.minus({ days: 2 }).toISO(),
      submitted_at: now.minus({ days: 1 }).toISO(),
    }),
  ];
}

/** Homework for a student (own) or parent (children). */
export async function getHomeworkForProfile(profile: Profile): Promise<HomeworkView[]> {
  if (isDemoMode) {
    const ids = demoChildren(profile).map((c) => c.id);
    return demoHomework()
      .filter((h) => ids.includes(h.student_id))
      .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  }
  // TODO(next stage): practice_assignments (mode at_home) + homework_submissions for the family's students.
  return [];
}

export async function getHomework(id: string): Promise<HomeworkView | null> {
  if (isDemoMode) return demoHomework().find((h) => h.id === id) ?? null;
  // TODO(next stage): homework_submissions by id under RLS.
  void id;
  return null;
}

/** Submitted homework awaiting a teacher's review (their students only). */
export async function getSubmittedForTeacher(teacher: Profile): Promise<HomeworkView[]> {
  if (isDemoMode) {
    const students = new Set(
      buildDemoSessionRequests()
        .filter((s) => s.assigned_teacher_id === teacher.id)
        .map((s) => s.student_id),
    );
    return demoHomework().filter((h) => h.status === "submitted" && students.has(h.student_id));
  }
  // TODO(next stage): homework_submissions awaiting verification for the teacher's sessions (RLS: assigned teacher).
  void teacher;
  return [];
}
