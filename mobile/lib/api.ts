import { supabase } from "./supabase";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "";

export const webUrlConfigured = Boolean(WEB_URL);

/** Deep link to open a lesson on the web (lessons run on iPad/laptop only). */
export function lessonWebUrl(sessionId: string): string {
  return `${WEB_URL.replace(/\/$/, "")}/lesson/${sessionId}`;
}

export interface BookingResult {
  ok: boolean;
  message: string;
}

/**
 * Booking/reschedule/cancel run through the bearer-authenticated web API
 * (/api/mobile/sessions), since session writes need the service role.
 */
export async function callBooking(payload: Record<string, unknown>): Promise<BookingResult> {
  if (!WEB_URL) {
    return { ok: false, message: "Booking needs EXPO_PUBLIC_WEB_URL configured." };
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  try {
    const res = await fetch(`${WEB_URL.replace(/\/$/, "")}/api/mobile/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<BookingResult>;
    return { ok: Boolean(data.ok), message: data.message ?? (res.ok ? "Done." : "Something went wrong.") };
  } catch {
    return { ok: false, message: "Network error — please try again." };
  }
}
