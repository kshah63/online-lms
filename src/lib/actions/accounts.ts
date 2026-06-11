"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { requireRole } from "@/lib/data/auth";
import type { Role } from "@/lib/types";

export type ProvisionResult = { ok: boolean; message: string; tempPassword?: string; email?: string };

const ROLES: Role[] = ["teacher", "student", "parent"];

function tempPassword(): string {
  return randomBytes(9).toString("base64url"); // ~12 chars, url-safe
}

function validTz(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public: anyone can request an account (admin approves later).
// ---------------------------------------------------------------------------
export async function submitAccountRequest(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const role = String(formData.get("role") ?? "");
  const display_name = String(formData.get("display_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const timezone = String(formData.get("timezone") ?? "UTC");
  const message = String(formData.get("message") ?? "").trim() || null;

  if (!ROLES.includes(role as Role)) return { ok: false, message: "Choose who the account is for." };
  if (!display_name || !email) return { ok: false, message: "Name and email are required." };

  if (isDemoMode) return { ok: true, message: "Thanks! (Demo mode — request not stored.)" };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Requests aren't available right now." };
  const { error } = await supabase
    .from("account_requests")
    .insert({ role, display_name, email, phone, timezone, message });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/people");
  return { ok: true, message: "Request received — an administrator will review it and set up your account." };
}

// ---------------------------------------------------------------------------
// Admin: provision a real login + profile (shared by create + approve).
// ---------------------------------------------------------------------------
async function provision(input: {
  role: Role;
  display_name: string;
  email: string;
  phone: string | null;
  timezone: string;
  parentId?: string | null;
}): Promise<ProvisionResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { ok: false, message: "User provisioning needs SUPABASE_SERVICE_ROLE_KEY configured." };
  }
  const tz = validTz(input.timezone) ? input.timezone : "UTC";
  const password = tempPassword();

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { role: input.role, display_name: input.display_name, timezone: tz },
  });
  if (error || !data.user) {
    return { ok: false, message: error?.message ?? "Could not create the account." };
  }
  const userId = data.user.id;

  // The signup trigger creates the profile from metadata; set everything
  // explicitly so it's correct regardless, and add the phone.
  await admin
    .from("profiles")
    .upsert({ id: userId, role: input.role, display_name: input.display_name, email: input.email, phone: input.phone, timezone: tz });

  if (input.parentId && input.role === "student") {
    await admin.from("parent_student").upsert({ parent_id: input.parentId, student_id: userId });
  }

  return { ok: true, message: "Account created.", tempPassword: password, email: input.email };
}

/** Admin: create a user directly. */
export async function createUserAccount(formData: FormData): Promise<ProvisionResult> {
  await requireRole("admin");
  const role = String(formData.get("role") ?? "") as Role;
  const display_name = String(formData.get("display_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const timezone = String(formData.get("timezone") ?? "UTC");
  const parentId = String(formData.get("parent_id") ?? "") || null;

  if (!ROLES.includes(role)) return { ok: false, message: "Pick a role." };
  if (!display_name || !email) return { ok: false, message: "Name and email are required." };

  if (isDemoMode) return { ok: true, message: "Demo mode: account not created.", tempPassword: "demo-mode" };

  const res = await provision({ role, display_name, email, phone, timezone, parentId });
  if (res.ok) revalidatePath("/admin/people");
  return res;
}

/** Admin: approve a pending request → provision the account. */
export async function approveAccountRequest(id: string): Promise<ProvisionResult> {
  await requireRole("admin");
  if (isDemoMode) return { ok: true, message: "Demo mode: not provisioned.", tempPassword: "demo-mode" };

  const profile = await requireRole("admin");
  const supabase = createSupabaseServerClient()!;
  const { data: req } = await supabase.from("account_requests").select("*").eq("id", id).maybeSingle();
  if (!req) return { ok: false, message: "Request not found." };

  const res = await provision({
    role: req.role,
    display_name: req.display_name,
    email: req.email,
    phone: req.phone,
    timezone: req.timezone,
  });
  if (!res.ok) return res;

  await supabase
    .from("account_requests")
    .update({ status: "approved", decided_by: profile.id, decided_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/people");
  return res;
}

/** Admin: reject a pending request. */
export async function rejectAccountRequest(id: string): Promise<void> {
  await requireRole("admin");
  if (!isDemoMode && id) {
    const supabase = createSupabaseServerClient()!;
    await supabase
      .from("account_requests")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", id);
  }
  revalidatePath("/admin/people");
}
