"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_COOKIE, homePathForRole } from "@/lib/data/auth";
import { demoProfiles } from "@/lib/demo/data";
import { isDemoMode } from "@/lib/env";

// ============================================================================
// Two sign-in doors, mirroring mv-app's app/(auth)/family.tsx and team.tsx.
// Account management (passwords, resets, sign-up) belongs to the app; the room
// only signs people in with the credentials they already have.
// ============================================================================

export type FamilyCodeState =
  | { stage: "ask"; error?: string }
  | { stage: "code"; email: string; error?: string };

export type TeamSignInState = { error: string } | null;

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

/**
 * A portal username resolves to an email through the anon RPC
 * email_for_username; an address is used as typed. One copy for both doors
 * (the same rule as mv-app's resolveEmail), so it cannot drift between them.
 */
async function resolveEmail(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  identifier: string,
): Promise<string> {
  const entered = identifier.trim().toLowerCase();
  if (entered.includes("@")) return entered;
  const { data, error } = await supabase.rpc("email_for_username", { p_username: entered });
  if (error) throw new Error(`email_for_username failed: ${error.message}`);
  return (data as string | null) ?? entered;
}

/** Family door, step 1: email a six-digit code. Never creates an account. */
export async function requestFamilyCode(_prev: FamilyCodeState, formData: FormData): Promise<FamilyCodeState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) return { stage: "ask", error: "Enter the email address or portal username MathVision has for you." };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { stage: "ask", error: "Sign-in is not configured." };

  let email: string;
  try {
    email = await resolveEmail(supabase, identifier);
  } catch (err) {
    return { stage: "ask", error: err instanceof Error ? err.message : "Could not look up that username." };
  }

  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) return { stage: "ask", error: friendlyOtpError(error.message) };
  return { stage: "code", email };
}

/** Family door, step 2: verify the code; an enrolled authenticator still owes its code. */
export async function verifyFamilyCode(_prev: FamilyCodeState, formData: FormData): Promise<FamilyCodeState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!email) return { stage: "ask", error: "Start again — the email to check was lost." };
  if (token.length !== 6) return { stage: "code", email, error: "Enter the six digits from the email." };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { stage: "code", email, error: "Sign-in is not configured." };

  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { stage: "code", email, error: friendlyOtpError(error.message) };

  if (await needsSecondFactor(supabase)) redirect("/mfa");
  redirect("/");
}

/** Team door: email or portal username plus password; enrolled accounts go through /mfa. */
export async function signInTeam(_prev: TeamSignInState, formData: FormData): Promise<TeamSignInState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) return { error: "Enter your email and password to continue." };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { error: "Sign-in is not configured." };

  let email: string;
  try {
    email = await resolveEmail(supabase, identifier);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not look up that username." };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendlyPasswordError(error.message) };

  if (await needsSecondFactor(supabase)) redirect("/mfa");
  redirect("/");
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

// --- helpers ----------------------------------------------------------------

async function needsSecondFactor(supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: levels } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return levels?.nextLevel === "aal2" && levels.nextLevel !== levels.currentLevel;
}

/** Supabase's refusals, said in this screen's voice (the same readings as the app). */
function friendlyOtpError(text: string): string {
  if (/signups? not allowed/i.test(text)) {
    return "We could not find an account for that email address. Work at MathVision? The office can look up your sign-in email.";
  }
  if (/rate limit|too many/i.test(text)) return "Too many codes requested — give it a minute, then try again.";
  if (/token has expired|invalid|expired/i.test(text)) return "That code did not work. Check the digits, or send a fresh one.";
  return text;
}

function friendlyPasswordError(text: string): string {
  if (/invalid login credentials/i.test(text)) return "That email and password do not match.";
  if (/banned|not active/i.test(text)) return "This account is not active. Ask the office if that is unexpected.";
  if (/email not confirmed/i.test(text)) return "This address has not been confirmed yet — open the link the office sent you, or ask for a new one in the app.";
  return text;
}
