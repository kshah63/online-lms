"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_COOKIE, homePathForRole } from "@/lib/data/auth";
import { demoProfiles } from "@/lib/demo/data";
import { isDemoMode } from "@/lib/env";
import { rateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";

/** Demo-mode: adopt one of the seed personas (sets a cookie, no real auth). */
export async function setDemoPersona(formData: FormData) {
  const id = String(formData.get("persona_id") ?? "");
  const profile = demoProfiles.find((p) => p.id === id);
  if (!profile) redirect("/login");

  cookies().set(DEMO_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(homePathForRole(profile.role));
}

/** Real-mode email/password sign-in. Redirects to /mfa when 2FA is enrolled. */
export async function signIn(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = createSupabaseServerClient();
  if (!supabase) return { error: "Auth is not configured." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // If this account has a verified TOTP factor, the session is only AAL1 so
  // far — finish with the 2FA challenge before landing anywhere.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasTotp = (factors?.totp ?? []).some((f) => f.status === "verified");
  if (hasTotp) redirect("/mfa");

  const { data } = await supabase.from("profiles").select("role").eq("email", email).maybeSingle();
  redirect(homePathForRole((data?.role as never) ?? "student"));
}

/** The site origin, derived from the request (works on Vercel + localhost). */
function requestOrigin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Send a password-reset email. Always reports success (never reveals whether
 * an email is registered) and is rate-limited per IP. */
export async function requestPasswordReset(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { ok: false, message: "Enter your email address." };

  const sent = { ok: true, message: "If that email has an account, a reset link is on its way." };
  if (isDemoMode) return sent;

  const allowed = await rateLimit(
    `pw_reset:${getClientIp()}`,
    LIMITS.passwordReset.limit,
    LIMITS.passwordReset.windowSeconds,
  );
  if (!allowed) return { ok: false, message: "Too many reset requests — try again later." };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Auth is not configured." };

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${requestOrigin()}/auth/callback?next=/reset-password`,
  });
  return sent; // same response either way — no account enumeration
}

/** Set a new password (requires a session — normal or recovery). */
export async function updatePassword(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { ok: false, message: "Use at least 8 characters." };
  if (password !== confirm) return { ok: false, message: "Passwords don't match." };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Auth is not configured." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Password updated — you can sign in with it now." };
}

/** Sign out (real mode) or clear the demo persona cookie. */
export async function signOut() {
  if (isDemoMode) {
    cookies().delete(DEMO_COOKIE);
  } else {
    const supabase = createSupabaseServerClient();
    await supabase?.auth.signOut();
  }
  redirect("/login");
}
