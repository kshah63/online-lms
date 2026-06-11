import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

/**
 * Identify the caller of a mobile API route from its `Authorization: Bearer
 * <supabase-access-token>` header. The native app has a Supabase session but no
 * cookies, so the usual cookie-bound server client can't see it. We verify the
 * JWT, then load the profile with the service-role client.
 */
export async function profileFromBearer(req: Request): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
  } = await anon.auth.getUser(token);
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return (data as Profile) ?? null;
}
