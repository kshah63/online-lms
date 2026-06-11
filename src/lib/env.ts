// Public Supabase config. When absent, the app runs in DEMO MODE: a built-in
// dataset and persona switcher stand in for real auth + Postgres, so the UI is
// fully explorable before you connect a Supabase project (see README).

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

export const isDemoMode = !isSupabaseConfigured;
