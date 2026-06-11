import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { captureError } from "@/lib/observability";
import { sendWhatsApp, sendWhatsAppTemplate } from "./whatsapp";
import { sendExpoPush } from "./push";

// ============================================================================
// Automated WhatsApp notifications (§11). Event helpers below resolve who to
// tell about a student (parent(s) + the student if they have their own phone),
// honour the per-profile opt-in, and send idempotently: a row is CLAIMED in
// outbound_messages by its unique dedupe_key BEFORE the send, so the reminders
// cron (every 15 min) and event triggers can never double-send.
//
// Delivery: if WHATSAPP_TEMPLATE_<KIND> is configured we send the approved
// template (works any time); otherwise we send free-form text (works in dev /
// simulated, and within WhatsApp's 24h window). All sends are logged.
// ============================================================================

type Recipient = {
  id: string;
  phone: string | null;
  timezone: string;
  whatsapp_opt_in: boolean;
  display_name: string;
};

/** A student's parent(s) + the student themselves if they have a phone on file. */
async function recipientsForStudent(
  admin: SupabaseClient,
  studentId: string,
): Promise<Recipient[]> {
  const out: Recipient[] = [];

  const { data: student } = await admin
    .from("profiles")
    .select("id, phone, timezone, whatsapp_opt_in, display_name")
    .eq("id", studentId)
    .maybeSingle();
  if (student?.phone) out.push(student as Recipient);

  const { data: links } = await admin
    .from("parent_student")
    .select("parent:profiles!parent_student_parent_id_fkey(id, phone, timezone, whatsapp_opt_in, display_name)")
    .eq("student_id", studentId);
  for (const l of links ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (l as any).parent as Recipient | null;
    if (p?.phone && !out.some((r) => r.id === p.id)) out.push(p);
  }
  return out;
}

interface NotifyInput {
  studentId: string;
  kind: string;
  /** Stable per-event id so we never resend (recipient is appended automatically). */
  dedupeBase: string;
  sessionId?: string | null;
  /** Builds the message for a given recipient (text + optional template params). */
  message: (r: Recipient) => { body: string; templateParams: string[] };
}

/** Core dispatch: claim-then-send per recipient, honouring opt-in + dedupe. */
async function notify(input: NotifyInput): Promise<void> {
  if (isDemoMode) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  const templateName = process.env[`WHATSAPP_TEMPLATE_${input.kind.toUpperCase()}`] || null;

  try {
    const recipients = await recipientsForStudent(admin, input.studentId);
    for (const r of recipients) {
      if (!r.phone || r.whatsapp_opt_in === false) continue;
      const dedupe_key = `${input.dedupeBase}:${r.id}`;
      const { body, templateParams } = input.message(r);

      // Claim the slot first; if it already exists we've handled this event.
      const { data: claimed, error } = await admin
        .from("outbound_messages")
        .upsert(
          {
            channel: "whatsapp",
            kind: input.kind,
            to_profile: r.id,
            to_phone: r.phone,
            body,
            status: "queued",
            session_id: input.sessionId ?? null,
            dedupe_key,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (error || !claimed) continue; // already claimed by another run

      const result = templateName
        ? await sendWhatsAppTemplate(r.phone, templateName, templateParams)
        : await sendWhatsApp(r.phone, body);

      await admin
        .from("outbound_messages")
        .update({ status: result.status, provider_ref: result.ref })
        .eq("id", claimed.id);

      // Also push to this recipient's mobile devices (best effort).
      const { data: tokens } = await admin
        .from("push_tokens")
        .select("token")
        .eq("profile_id", r.id);
      await sendExpoPush(
        (tokens ?? []).map((t) => t.token as string),
        "MathVision Global",
        body,
        { kind: input.kind, sessionId: input.sessionId ?? null },
      );
    }
  } catch (err) {
    captureError(err, { where: "notify", kind: input.kind });
  }
}

function when(iso: string, tz: string): string {
  return DateTime.fromISO(iso, { zone: "utc" })
    .setZone(tz || "UTC")
    .toFormat("ccc d LLL, h:mm a");
}

// ---------------------------------------------------------------------------
// Event helpers — called from server actions / the reminders cron.
// ---------------------------------------------------------------------------

export async function notifyReportPublished(opts: {
  studentId: string;
  studentName: string;
  course: string;
  sessionId: string;
}): Promise<void> {
  const first = opts.studentName.split(" ")[0];
  await notify({
    studentId: opts.studentId,
    kind: "report_published",
    dedupeBase: `report_published:${opts.sessionId}`,
    sessionId: opts.sessionId,
    message: () => ({
      body: `MathVision Global: ${first}'s lesson report for ${opts.course} is ready. Log in to view it.`,
      templateParams: [first, opts.course],
    }),
  });
}

export async function notifyBookingConfirmed(opts: {
  studentId: string;
  studentName: string;
  course: string;
  sessionId: string;
  startISO: string;
}): Promise<void> {
  const first = opts.studentName.split(" ")[0];
  await notify({
    studentId: opts.studentId,
    kind: "booking_confirmed",
    dedupeBase: `booking_confirmed:${opts.sessionId}`,
    sessionId: opts.sessionId,
    message: (r) => ({
      body: `MathVision Global: ${first}'s ${opts.course} lesson is booked for ${when(opts.startISO, r.timezone)} (${r.timezone}).`,
      templateParams: [first, opts.course, when(opts.startISO, r.timezone)],
    }),
  });
}

export async function notifyBookingChanged(opts: {
  studentId: string;
  studentName: string;
  course: string;
  sessionId: string;
  startISO: string;
  changeId: string; // makes the dedupe key unique per change
}): Promise<void> {
  const first = opts.studentName.split(" ")[0];
  await notify({
    studentId: opts.studentId,
    kind: "booking_rescheduled",
    dedupeBase: `booking_rescheduled:${opts.sessionId}:${opts.changeId}`,
    sessionId: opts.sessionId,
    message: (r) => ({
      body: `MathVision Global: ${first}'s ${opts.course} lesson has been moved to ${when(opts.startISO, r.timezone)} (${r.timezone}).`,
      templateParams: [first, opts.course, when(opts.startISO, r.timezone)],
    }),
  });
}

export async function notifyBookingCancelled(opts: {
  studentId: string;
  studentName: string;
  course: string;
  sessionId: string;
}): Promise<void> {
  const first = opts.studentName.split(" ")[0];
  await notify({
    studentId: opts.studentId,
    kind: "booking_cancelled",
    dedupeBase: `booking_cancelled:${opts.sessionId}`,
    sessionId: opts.sessionId,
    message: () => ({
      body: `MathVision Global: ${first}'s ${opts.course} lesson has been cancelled. Log in to rebook.`,
      templateParams: [first, opts.course],
    }),
  });
}

/** Reminder for an upcoming lesson. `bucket` ("24h" | "1h") keeps the two sends distinct. */
export async function notifyLessonReminder(opts: {
  studentId: string;
  studentName: string;
  course: string;
  sessionId: string;
  startISO: string;
  bucket: string;
}): Promise<void> {
  const first = opts.studentName.split(" ")[0];
  await notify({
    studentId: opts.studentId,
    kind: "lesson_reminder",
    dedupeBase: `reminder_${opts.bucket}:${opts.sessionId}`,
    sessionId: opts.sessionId,
    message: (r) => ({
      body: `MathVision Global reminder: ${first}'s ${opts.course} lesson is at ${when(opts.startISO, r.timezone)} (${r.timezone}). Join from your iPad or laptop.`,
      templateParams: [first, opts.course, when(opts.startISO, r.timezone)],
    }),
  });
}
