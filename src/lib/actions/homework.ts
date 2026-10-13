"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/env";

// ============================================================================
// Homework writes, behind the data layer. online-lms's homework table is
// retired; hand-ins become homework_submissions and marks go on the row
// (verified_by, mark, feedback). TODO(next stage): write through mv-app RPCs or
// RLS-covered inserts on homework_submissions. Until then the live paths refuse
// loudly rather than pretend.
// ============================================================================

function notPortedYet(): never {
  throw new Error("Homework is submitted and marked in the MathVision app until the next integration stage.");
}

/** Persist the tldraw page created for this homework the first time it's opened. */
export async function setHomeworkPage(id: string, pageId: string): Promise<void> {
  if (isDemoMode) return;
  void id;
  void pageId;
  notPortedYet();
}

/** Student submits their work on the notebook for review. */
export async function submitHomework(id: string): Promise<void> {
  if (!isDemoMode) notPortedYet();
  revalidatePath("/home/homework");
  revalidatePath("/home");
  revalidatePath(`/hw/${id}`);
}

export interface HomeworkGrade {
  verified: boolean;
  correct?: number | null;
  incorrect?: number | null;
  notDone?: number | null;
  feedback?: string | null;
}

/** Teacher grades the submitted work: marks (quantifiable) + comment, and verifies complete or sends it back. */
export async function gradeHomework(id: string, grade: HomeworkGrade): Promise<void> {
  if (!isDemoMode) {
    void grade;
    notPortedYet();
  }
  revalidatePath("/teacher/homework");
  revalidatePath(`/hw/${id}`);
  revalidatePath("/home/homework");
  revalidatePath("/home");
}
