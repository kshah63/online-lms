import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isDemoMode } from "@/lib/env";
import { safeRelativePath } from "@/lib/join/path";

export const dynamic = "force-dynamic";

/**
 * Redeem a lesson ticket (docs/INTEGRATION.md "Zero-login hand-off", steps 5–6).
 *
 * 1. POST the token to mv-app's room-redeem edge function with the anon key as
 *    the bearer plus the shared ROOM_REDEEM_SECRET header. It hashes the token,
 *    redeems it once, mints a magic-link token for that user with the service
 *    role (which never leaves Supabase) and returns { hashed_token, user_id, next }.
 * 2. verifyOtp({ token_hash, type: 'magiclink' }) on the cookie-bound SSR client,
 *    assert the session is for user_id, and hand the browser the next path.
 *
 * Errors come back as JSON (401/404) for the /join page to show.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; next?: unknown };
  const requestedNext = safeRelativePath(body.next) ?? "/";

  if (isDemoMode) return NextResponse.json({ next: requestedNext });

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "This link is missing its ticket." }, { status: 400 });

  const secret = (process.env.ROOM_REDEEM_SECRET ?? "").trim();
  if (!secret) return NextResponse.json({ error: "The room's ticket door is not configured." }, { status: 500 });

  const redeem = await fetch(`${SUPABASE_URL}/functions/v1/room-redeem`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      "x-room-secret": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });

  if (redeem.status === 404) {
    return NextResponse.json({ error: "This link has expired or was already used. Open the lesson from the app again." }, { status: 404 });
  }
  if (!redeem.ok) {
    return NextResponse.json({ error: `The ticket could not be redeemed (${redeem.status}).` }, { status: 502 });
  }

  const redeemed = (await redeem.json()) as { hashed_token?: string; user_id?: string; next?: string };
  if (!redeemed.hashed_token || !redeemed.user_id) {
    return NextResponse.json({ error: "The ticket came back incomplete." }, { status: 502 });
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Sign-in is not configured." }, { status: 500 });

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: redeemed.hashed_token, type: "magiclink" });
  if (error || !data.session) {
    return NextResponse.json({ error: "This link could not sign you in." }, { status: 401 });
  }
  if (data.session.user.id !== redeemed.user_id) {
    // Never keep a session for somebody other than the ticket's owner.
    await supabase.auth.signOut();
    return NextResponse.json({ error: "This link belongs to a different account." }, { status: 401 });
  }

  const next = safeRelativePath(redeemed.next) ?? requestedNext;
  return NextResponse.json({ next });
}
