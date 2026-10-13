import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ============================================================================
// Source-shape test: the room runs on mv-app's project and nothing may query a
// table that only existed in online-lms, hold a service-role key, or send a
// WhatsApp. A table name that comes back is a page that will 42P01 in
// production while looking fine in demo mode.
// ============================================================================

const RETIRED_TABLES = [
  "sessions",
  "reports",
  "homework",
  "followups",
  "notifications",
  "parent_student",
  "enrollments",
  "teacher_course",
  "consents",
  "outbound_messages",
  "account_requests",
  "enrollment_requests",
  "rate_limits",
  "push_tokens",
  "audit_log",
  "transcripts",
  "session_metrics",
  "live_events",
  "teacher_feedback",
  "notebooks",
  "teacher_availability",
  "credit_balances",
  "credit_ledger",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(join(__dirname, "..", "src"));

describe("the room queries only mv-app's tables", () => {
  it("never selects a retired online-lms table", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const t of RETIRED_TABLES) {
        if (src.includes(`from("${t}")`) || src.includes(`from('${t}')`)) offenders.push(`${f}: ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("holds no service-role key and sends no WhatsApp", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/SUPABASE_SERVICE_ROLE_KEY|createSupabaseAdminClient|WHATSAPP_TOKEN|rl_check/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("never selects * from profiles (the column wall on email and phone)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/from\("profiles"\)\s*\.select\(\s*"\*"\s*\)/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
