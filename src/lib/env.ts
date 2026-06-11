// Public Supabase config. When absent or malformed, the app runs in DEMO MODE:
// a built-in dataset and persona switcher stand in for real auth + Postgres, so
// the UI is fully explorable before you connect a Supabase project (see README).

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const rawKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const SUPABASE_URL = rawUrl;
export const SUPABASE_ANON_KEY = rawKey;

// Require a *valid* URL — a malformed value (quotes, missing https://, a stray
// newline) would otherwise crash @supabase/ssr at runtime. If it's invalid we
// fall back to demo mode rather than 500, which surfaces the misconfiguration.
export const isSupabaseConfigured = isValidHttpUrl(rawUrl) && rawKey.length > 0;

export const isDemoMode = !isSupabaseConfigured;
