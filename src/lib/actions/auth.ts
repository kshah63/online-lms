"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_COOKIE, homePathForRole } from "@/lib/data/auth";
import { demoProfiles } from "@/lib/demo/data";
import { isDemoMode } from "@/lib/env";

/** Demo-mode: adopt one of the seed personas (sets a cookie, no real auth). */
export async function setDemoPersona(formData: FormData) {
  const id = String(formData.get("persona_id") ?? "");
  const profile = demoProfiles.find((p) => p.id === id);
  if (!profile) redirect("/login");

  cookies().set(DEMO_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(homePathForRole(profile.role));
}

/** Real-mode email/password sign-in. */
export async function signIn(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = createSupabaseServerClient();
  if (!supabase) return { error: "Auth is not configured." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  const { data } = await supabase.from("profiles").select("role").eq("email", email).maybeSingle();
  redirect(homePathForRole((data?.role as never) ?? "student"));
}

/** Sign out (real mode) or clear the demo persona cookie. */
export async function signOut() {
  if (isDemoMode) {
    cookies().delete(DEMO_COOKIE);
  } else {
    const supabase = createSupabaseServerClient();
    await supabase?.auth.signOut();
  }
  redirect("/login");
}
