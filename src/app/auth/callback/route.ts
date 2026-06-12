import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Supabase auth callback — the landing point for emailed links (password
 * recovery, email verification, invites). Exchanges the one-time code for a
 * session cookie, then forwards to `next` (e.g. /reset-password).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  // Only allow same-origin relative redirects.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
    }
  }

  const err = url.searchParams.get("error_description") ?? "This link is invalid or has expired.";
  return NextResponse.redirect(
    new URL(`/login?message=${encodeURIComponent(err)}`, url.origin),
  );
}
