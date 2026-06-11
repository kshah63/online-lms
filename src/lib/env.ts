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
// newline) would otherwise crash @supabase/ssr at runtime.
export const isSupabaseConfigured = isValidHttpUrl(rawUrl) && rawKey.length > 0;

const isProduction = process.env.NODE_ENV === "production";

// Demo mode (built-in data + persona switcher + auto-admin) is for LOCAL DEV
// ONLY. In production a missing/invalid config is a misconfiguration, not a
// reason to silently open an auto-admin app — we hard-fail instead.
export const isDemoMode = !isSupabaseConfigured && !isProduction;
export const isMisconfigured = isProduction && !isSupabaseConfigured;
