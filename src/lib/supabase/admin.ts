import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";

// Service-role client — bypasses RLS. Use ONLY in server actions/routes after
// verifying the caller is allowed to do the operation. Never expose to the
// client. Backed by SUPABASE_SERVICE_ROLE_KEY.
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

export const adminConfigured = isSupabaseConfigured && SERVICE_KEY.length > 0;

export function createSupabaseAdminClient() {
  if (!adminConfigured) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
