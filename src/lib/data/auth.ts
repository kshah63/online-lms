import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoProfiles } from "@/lib/demo/data";
import type { Profile, Role } from "@/lib/types";

export const DEMO_COOKIE = "demo_persona";
const DEFAULT_DEMO_ID = "00000000-0000-0000-0000-000000000001"; // admin

/** The signed-in profile, or null if unauthenticated. */
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

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // Surfaces in server logs (e.g. RLS/migration issues) without 500-ing.
    console.error("getCurrentProfile failed:", error.message);
    return null;
  }
  return (data as Profile) ?? null;
}

/** Require a signed-in profile; redirect to /login otherwise. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Require one of the given roles; redirect home if the role doesn't match. */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

/** The landing route for a role after login. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "teacher":
      return "/teacher";
    default:
      return "/home";
  }
}
