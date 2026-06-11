import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { profileFromBearer } from "@/lib/mobile/auth";
import {
  notifyBookingConfirmed,
  notifyBookingChanged,
  notifyBookingCancelled,
} from "@/lib/messaging/notify";
import type { Profile } from "@/lib/types";

// ============================================================================
// Bearer-authenticated booking API for the native app. Session writes need the
// service role (RLS keeps them admin/teacher-only), so the app can't insert
// directly — it calls here with its Supabase access token. Mirrors the web
// server actions in src/lib/actions/bookings.ts.
//   POST { op: "book"      , student_id, course_id, date, time, timezone, duration, agenda }
//   POST { op: "reschedule", session_id, date, time, timezone, duration }
//   POST { op: "cancel"    , session_id, reason }
// ============================================================================

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

/** Student ids this profile may act for (self for a student, children for a parent). */
async function actableStudentIds(admin: Admin, profile: Profile): Promise<string[]> {
  if (profile.role === "student") return [profile.id];
  if (profile.role === "parent") {
    const { data } = await admin
      .from("parent_student")
      .select("student_id")
      .eq("parent_id", profile.id);
    return (data ?? []).map((r) => r.student_id as string);
  }
  return []; // admin handled separately (may act for anyone)
}

async function studentAndCourse(admin: Admin, studentId: string, courseId: string) {
  const [{ data: student }, { data: course }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", studentId).maybeSingle(),
    admin.from("courses").select("name").eq("id", courseId).maybeSingle(),
  ]);
  return {
    studentName: (student?.display_name as string) ?? "your child",
    course: (course?.name as string) ?? "the lesson",
  };
}

export async function POST(req: Request) {
  const profile = await profileFromBearer(req);
  if (!profile) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, message: "Server not configured." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const op = String(body.op ?? "");
  const isAdmin = profile.role === "admin";

  // ---- book ----------------------------------------------------------------
  if (op === "book") {
    const student_id = String(body.student_id ?? "");
    const course_id = String(body.course_id ?? "");
    const date = String(body.date ?? "");
    const time = String(body.time ?? "");
    const tz = String(body.timezone ?? "UTC");
    const duration = Number(body.duration ?? 60);
    const agenda = (body.agenda ? String(body.agenda) : null) as string | null;

    if (!student_id || !course_id || !date || !time) {
      return NextResponse.json({ ok: false, message: "Pick a student, course, date and time." });
    }
    if (!isAdmin && !(await actableStudentIds(admin, profile)).includes(student_id)) {
      return NextResponse.json({ ok: false, message: "You can only book for your own account." });
    }
    const { data: enrolled } = await admin
      .from("enrollments")
      .select("course_id")
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .maybeSingle();
    if (!enrolled) {
      return NextResponse.json({ ok: false, message: "That student isn't enrolled in this course." });
    }

    const start = DateTime.fromISO(`${date}T${time}`, { zone: tz });
    if (!start.isValid) return NextResponse.json({ ok: false, message: "Invalid date or time." });
    if (start < DateTime.now()) return NextResponse.json({ ok: false, message: "Pick a future time." });

    const startISO = start.toUTC().toISO()!;
    const { data: created, error } = await admin
      .from("sessions")
      .insert({
        course_id,
        student_id,
        teacher_id: null,
        scheduled_start: startISO,
        scheduled_end: start.plus({ minutes: duration }).toUTC().toISO(),
        status: "scheduled",
        agenda,
      })
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, message: error.message });

    if (created?.id) {
      const { studentName, course } = await studentAndCourse(admin, student_id, course_id);
      await notifyBookingConfirmed({ studentId: student_id, studentName, course, sessionId: created.id, startISO });
    }
    return NextResponse.json({ ok: true, message: "Lesson requested — an admin will assign a teacher." });
  }

  // ---- reschedule / cancel both need the session ---------------------------
  const session_id = String(body.session_id ?? "");
  if (!session_id) return NextResponse.json({ ok: false, message: "Missing lesson." });

  const { data: session } = await admin
    .from("sessions")
    .select("id, student_id, course_id, status, course:courses(name), student:profiles!sessions_student_id_fkey(display_name)")
    .eq("id", session_id)
    .maybeSingle();
  if (!session) return NextResponse.json({ ok: false, message: "Lesson not found." });

  const owns = isAdmin || (await actableStudentIds(admin, profile)).includes(session.student_id as string);
  if (!owns) return NextResponse.json({ ok: false, message: "You can't change this lesson." });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sAny = session as any;
  const studentName = (sAny.student?.display_name as string) ?? "your child";
  const course = (sAny.course?.name as string) ?? "the lesson";

  if (op === "reschedule") {
    const date = String(body.date ?? "");
    const time = String(body.time ?? "");
    const tz = String(body.timezone ?? "UTC");
    const duration = Number(body.duration ?? 60);
    if (!date || !time) return NextResponse.json({ ok: false, message: "Pick a new date and time." });
    if (!isAdmin && !["scheduled", "confirmed"].includes(session.status as string)) {
      return NextResponse.json({ ok: false, message: "This lesson can no longer be rescheduled." });
    }
    const start = DateTime.fromISO(`${date}T${time}`, { zone: tz });
    if (!start.isValid) return NextResponse.json({ ok: false, message: "Invalid date or time." });
    if (!isAdmin && start < DateTime.now()) return NextResponse.json({ ok: false, message: "Pick a future time." });

    const startISO = start.toUTC().toISO()!;
    const { error } = await admin
      .from("sessions")
      .update({ scheduled_start: startISO, scheduled_end: start.plus({ minutes: duration }).toUTC().toISO() })
      .eq("id", session_id);
    if (error) return NextResponse.json({ ok: false, message: error.message });

    await notifyBookingChanged({ studentId: session.student_id as string, studentName, course, sessionId: session_id, startISO, changeId: startISO });
    return NextResponse.json({ ok: true, message: "Lesson rescheduled." });
  }

  if (op === "cancel") {
    const reason = (body.reason ? String(body.reason) : null) as string | null;
    const { error } = await admin
      .from("sessions")
      .update({ status: "cancelled", cancel_reason: reason })
      .eq("id", session_id);
    if (error) return NextResponse.json({ ok: false, message: error.message });

    await notifyBookingCancelled({ studentId: session.student_id as string, studentName, course, sessionId: session_id });
    return NextResponse.json({ ok: true, message: "Lesson cancelled." });
  }

  return NextResponse.json({ ok: false, message: "Unknown operation." }, { status: 400 });
}
