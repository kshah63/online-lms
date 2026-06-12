"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getChildren, getEnrolledCourses } from "@/lib/data/people";
import {
  notifyBookingConfirmed,
  notifyBookingChanged,
  notifyBookingCancelled,
} from "@/lib/messaging/notify";
import {
  findStudentConflict,
  isOverlapViolation,
  CONFLICT_MESSAGE,
} from "@/lib/booking/conflicts";
import { logAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/actions/types";

const EDITABLE = ["scheduled", "confirmed"];

function revalidateBookings() {
  revalidatePath("/home");
  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
}

/** Students of this profile (self for a student, children for a parent). */
async function bookableStudentIds(): Promise<{ role: string; ids: string[] } | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (profile.role === "admin") return { role: "admin", ids: [] }; // admin may target anyone
  const kids = await getChildren(profile); // self for student, children for parent
  return { role: profile.role, ids: kids.map((k) => k.id) };
}

/** Student/parent books a lesson (unassigned — admin assigns the teacher). */
export async function bookLesson(formData: FormData): Promise<ActionResult> {
  const student_id = String(formData.get("student_id") ?? "");
  const course_id = String(formData.get("course_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const tz = String(formData.get("timezone") ?? "UTC");
  const duration = Number(formData.get("duration") ?? 60);
  const agenda = String(formData.get("agenda") ?? "") || null;

  if (!student_id || !course_id || !date || !time) {
    return { ok: false, message: "Pick a student, course, date and time." };
  }

  const scope = await bookableStudentIds();
  if (!scope) return { ok: false, message: "Not signed in." };
  if (scope.role !== "admin" && !scope.ids.includes(student_id)) {
    return { ok: false, message: "You can only book lessons for your own account." };
  }

  // The course must be one the student is enrolled in.
  const enrolled = await getEnrolledCourses(student_id);
  if (!enrolled.some((c) => c.id === course_id)) {
    return { ok: false, message: "That student isn't enrolled in this course." };
  }

  const start = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!start.isValid) return { ok: false, message: "Invalid date or time." };
  if (start < DateTime.now()) return { ok: false, message: "Pick a time in the future." };

  if (isDemoMode) {
    revalidateBookings();
    return { ok: true, message: "Demo mode: booking not persisted." };
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Booking isn't available — server not configured." };

  const startISO = start.toUTC().toISO()!;
  const endISO = start.plus({ minutes: duration }).toUTC().toISO()!;

  // No double-booking: reject if the student already has a lesson in the slot.
  if (await findStudentConflict(supabase, student_id, startISO, endISO)) {
    return { ok: false, message: CONFLICT_MESSAGE };
  }

  const { data: created, error } = await supabase
    .from("sessions")
    .insert({
      course_id,
      student_id,
      teacher_id: null,
      scheduled_start: startISO,
      scheduled_end: endISO,
      status: "scheduled",
      agenda,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, message: isOverlapViolation(error) ? CONFLICT_MESSAGE : error.message };
  }

  // Confirm to the family by WhatsApp (no-op without opt-in/provider).
  if (created?.id) {
    const course = enrolled.find((c) => c.id === course_id);
    const { data: student } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", student_id)
      .maybeSingle();
    await notifyBookingConfirmed({
      studentId: student_id,
      studentName: student?.display_name ?? "your child",
      course: course?.name ?? "the lesson",
      sessionId: created.id,
      startISO,
    });
    await logAudit(await getCurrentProfile(), "booking.create", { type: "session", id: created.id }, {
      student_id,
      course_id,
      scheduled_start: startISO,
    });
  }

  revalidateBookings();
  return { ok: true, message: "Lesson requested — an admin will assign a teacher." };
}

/** Reschedule a booking. Admin: any session. Student/parent: their own, upcoming. */
export async function rescheduleSession(formData: FormData): Promise<ActionResult> {
  const session_id = String(formData.get("session_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const tz = String(formData.get("timezone") ?? "UTC");
  const duration = Number(formData.get("duration") ?? 60);

  if (!session_id || !date || !time) return { ok: false, message: "Pick a new date and time." };

  const profile = await getCurrentProfile();
  const session = await getSessionById(session_id); // RLS-scoped: only returns if visible
  if (!profile || !session) return { ok: false, message: "Lesson not found." };

  const owns =
    profile.role === "admin" ||
    (await bookableStudentIds())?.ids.includes(session.student_id);
  if (!owns) return { ok: false, message: "You can't edit this lesson." };
  if (profile.role !== "admin" && !EDITABLE.includes(session.status)) {
    return { ok: false, message: "This lesson can no longer be rescheduled." };
  }

  const start = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!start.isValid) return { ok: false, message: "Invalid date or time." };
  if (profile.role !== "admin" && start < DateTime.now()) {
    return { ok: false, message: "Pick a time in the future." };
  }

  if (isDemoMode) {
    revalidateBookings();
    return { ok: true, message: "Demo mode: change not persisted." };
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Rescheduling isn't available — server not configured." };

  const newStartISO = start.toUTC().toISO()!;
  const newEndISO = start.plus({ minutes: duration }).toUTC().toISO()!;

  // No double-booking (ignoring the session being moved itself).
  if (await findStudentConflict(supabase, session.student_id, newStartISO, newEndISO, session_id)) {
    return { ok: false, message: CONFLICT_MESSAGE };
  }

  const { error } = await supabase
    .from("sessions")
    .update({ scheduled_start: newStartISO, scheduled_end: newEndISO })
    .eq("id", session_id);
  if (error) {
    return { ok: false, message: isOverlapViolation(error) ? CONFLICT_MESSAGE : error.message };
  }

  await notifyBookingChanged({
    studentId: session.student_id,
    studentName: session.student.display_name,
    course: session.course.name,
    sessionId: session_id,
    startISO: newStartISO,
    changeId: newStartISO, // unique per reschedule target
  });
  await logAudit(profile, "booking.reschedule", { type: "session", id: session_id }, {
    from: session.scheduled_start,
    to: newStartISO,
  });

  revalidateBookings();
  return { ok: true, message: "Lesson rescheduled." };
}

/** Cancel a booking. Admin: any. Student/parent: their own, upcoming. */
export async function cancelBooking(formData: FormData): Promise<ActionResult> {
  const session_id = String(formData.get("session_id") ?? "");
  const reason = String(formData.get("reason") ?? "") || null;
  if (!session_id) return { ok: false, message: "Missing lesson." };

  const profile = await getCurrentProfile();
  const session = await getSessionById(session_id);
  if (!profile || !session) return { ok: false, message: "Lesson not found." };

  const owns =
    profile.role === "admin" ||
    (await bookableStudentIds())?.ids.includes(session.student_id);
  if (!owns) return { ok: false, message: "You can't cancel this lesson." };

  if (isDemoMode) {
    revalidateBookings();
    return { ok: true, message: "Demo mode: cancellation not persisted." };
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Cancelling isn't available — server not configured." };

  const { error } = await supabase
    .from("sessions")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", session_id);
  if (error) return { ok: false, message: error.message };

  await notifyBookingCancelled({
    studentId: session.student_id,
    studentName: session.student.display_name,
    course: session.course.name,
    sessionId: session_id,
  });
  await logAudit(profile, "booking.cancel", { type: "session", id: session_id }, {
    reason,
    scheduled_start: session.scheduled_start,
  });

  revalidateBookings();
  return { ok: true, message: "Lesson cancelled." };
}
