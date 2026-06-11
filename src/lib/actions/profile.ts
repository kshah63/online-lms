"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";

/** Is this a valid IANA timezone the runtime understands? */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep the signed-in profile's timezone in sync with their device. Called from
 * the client when the browser's detected zone differs — so a student who
 * travels sees all times in wherever they currently are.
 */
export async function syncTimezone(tz: string): Promise<void> {
  if (isDemoMode || !isValidTimezone(tz)) return;
  const profile = await getCurrentProfile();
  if (!profile || profile.timezone === tz) return;

  const supabase = createSupabaseServerClient()!;
  await supabase.from("profiles").update({ timezone: tz }).eq("id", profile.id);
  revalidatePath("/", "layout");
}
