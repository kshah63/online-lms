import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoProfiles } from "@/lib/demo/data";
import { isOffice } from "@/lib/permissions";
import type { Profile, Role } from "@/lib/types";

export const DEMO_COOKIE = "demo_persona";
const DEFAULT_DEMO_ID = "00000000-0000-0000-0000-000000000001"; // admin

/**
 * The signed-in profile from rpc my_profile(), or null if unauthenticated.
 * Never `select * from profiles`: the authenticated role cannot read email or
 * phone (the column wall), and my_profile is the sanctioned door for one's own
 * row. Email and phone are dropped here so nothing downstream can show them.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  if (isDemoMode) {
    const id = cookies().get(DEMO_COOKIE)?.value ?? DEFAULT_DEMO_ID;
    return demoProfiles.find((p) => p.id === id) ?? null;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("my_profile").maybeSingle();
  if (error) {
    // Surfaces in server logs (an RPC or RLS issue) without 500-ing the page.
    console.error("my_profile failed:", error.message);
    return null;
  }
  return data ? toProfile(data as Record<string, unknown>) : null;
}

/** Pick the room's Profile columns off a my_profile() row. */
export function toProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    role: row.role as Role,
    full_name: String(row.full_name ?? ""),
    preferred_name: (row.preferred_name as string | null) ?? null,
    family_id: (row.family_id as string | null) ?? null,
    grade_level: (row.grade_level as string | null) ?? null,
    time_zone: (row.time_zone as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    deactivated_at: (row.deactivated_at as string | null) ?? null,
    report_auto_approve: Boolean(row.report_auto_approve),
  };
}

/** Why an account may not use the room: not yet approved, or closed. Mirrors app/_layout.tsx. */
export function accountGate(profile: Profile): "pending" | "inactive" | null {
  if (profile.deactivated_at != null) return "inactive";
  if (profile.approved_at === null) return "pending";
  return null;
}

/**
 * Require a signed-in, active profile; redirect to /login otherwise. Staff,
 * support and admin accounts with a verified authenticator must finish the
 * TOTP challenge once per browser (a ticket-minted session is aal1), so they
 * go through /mfa first. Families and students have no MFA.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const gate = accountGate(profile);
  if (gate) redirect(`/account?state=${gate}`);

  if (!isDemoMode && isOffice(profile.role)) {
    const supabase = createSupabaseServerClient();
    if (supabase) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2") redirect("/mfa");
    }
  }
  return profile;
}

/** Require one of the given roles; send the person to their own home otherwise. */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect(homePathForRole(profile.role));
  return profile;
}

/** The landing route for a role after login. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case "admin":
    case "staff":
    case "support":
      return "/admin";
    case "teacher":
      return "/teacher";
    case "student":
    case "parent":
    case "ambassador":
    default:
      return "/home";
  }
}

/** The zone times are shown in for a viewer: their profile's, else the centre's. */
export function viewerTimeZone(profile: Pick<Profile, "time_zone">, fallback = "Asia/Singapore"): string {
  return profile.time_zone || fallback;
}
