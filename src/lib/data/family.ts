import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoChildren } from "@/lib/demo/data";
import { toProfile } from "@/lib/data/auth";
import type { Profile } from "@/lib/types";

// Parent ↔ child is the same families row: profiles.family_id. Only the
// columns the room may read are selected — never email or phone, which the
// authenticated role cannot see on profiles (the column wall).
const PROFILE_COLUMNS =
  "id, role, full_name, preferred_name, family_id, grade_level, time_zone, avatar_url, approved_at, deactivated_at, report_auto_approve";

/** Children of a parent (their own profile for a student; nobody for other roles). */
export async function getChildren(profile: Profile): Promise<Profile[]> {
  if (profile.role === "student") return [profile];
  if (profile.role !== "parent" || !profile.family_id) return [];

  if (isDemoMode) return demoChildren(profile);

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("family_id", profile.family_id)
    .eq("role", "student")
    .is("deactivated_at", null)
    .order("full_name");
  if (error) throw new Error(`children lookup failed: ${error.message}`);
  return (data ?? []).map((row) => toProfile(row as Record<string, unknown>));
}
