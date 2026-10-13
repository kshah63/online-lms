import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoChildren, demoProfiles } from "@/lib/demo/data";
import { toProfile } from "@/lib/data/auth";
import { displayName, type Profile } from "@/lib/types";

// Parent ↔ child is the same families row: profiles.family_id. Only the
// columns the authenticated role may SELECT on profiles are named here —
// never email or phone (the column wall), and not report_auto_approve, which
// is granted for one's own row through my_profile() only.
const PROFILE_COLUMNS =
  "id, role, full_name, preferred_name, family_id, grade_level, time_zone, avatar_url, approved_at, deactivated_at";

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
  return (data ?? []).map((row) => toProfile({ ...(row as Record<string, unknown>), report_auto_approve: false }));
}

/** Display names for profile ids the viewer may see under RLS (missing ids are left out). */
export async function getDisplayNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  if (isDemoMode) {
    for (const p of demoProfiles) if (unique.includes(p.id)) out.set(p.id, displayName(p));
    return out;
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("profiles").select("id, full_name, preferred_name").in("id", unique);
  if (error) throw new Error(`names lookup failed: ${error.message}`);
  for (const row of (data ?? []) as { id: string; full_name: string; preferred_name: string | null }[]) {
    out.set(row.id, displayName(row));
  }
  return out;
}
