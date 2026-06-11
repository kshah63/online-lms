import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyLessonReminder } from "@/lib/messaging/notify";

// ============================================================================
// Lesson reminder cron (§11). Vercel hits this on a schedule (see vercel.json,
// every 15 min). Sends a ~24h-ahead and a ~1h-ahead WhatsApp reminder per
// lesson. Idempotent: notify() dedupes by (session, bucket, recipient), so wide
// windows + frequent runs never double-send. No-op in dev / without a provider.
// ============================================================================

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — this is an unauthenticated route
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: true, skipped: "not configured" });

  const now = Date.now();
  const lower = new Date(now + 30 * 60_000).toISOString(); // +30 min
  const upper = new Date(now + 25 * 60 * 60_000).toISOString(); // +25 h

  const { data: sessions, error } = await admin
    .from("sessions")
    .select(
      "id, scheduled_start, student_id, course:courses(name), student:profiles!sessions_student_id_fkey(display_name)",
    )
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_start", lower)
    .lte("scheduled_start", upper);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const s of sessions ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = s as any;
    const minutesUntil = (new Date(row.scheduled_start).getTime() - now) / 60_000;
    // Two windows with a gap in between; dedupe handles the boundary overlap.
    const bucket = minutesUntil <= 90 ? "1h" : minutesUntil >= 23 * 60 ? "24h" : null;
    if (!bucket) continue;

    await notifyLessonReminder({
      studentId: row.student_id,
      studentName: row.student?.display_name ?? "your child",
      course: row.course?.name ?? "the lesson",
      sessionId: row.id,
      startISO: row.scheduled_start,
      bucket,
    });
    sent++;
  }

  return NextResponse.json({ ok: true, considered: sessions?.length ?? 0, dispatched: sent });
}
