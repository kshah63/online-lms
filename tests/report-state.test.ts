import { describe, expect, it } from "vitest";
import { needsReport, reportState } from "@/lib/data/reports";
import type { OnlineLesson } from "@/lib/types";

const base: OnlineLesson = {
  session_id: "s1",
  student_id: "st",
  student_name: "Aarav Sharma",
  subject: "IGCSE Mathematics",
  topic: null,
  effective_start: "2026-10-12T01:00:00.000Z",
  ends_at: "2026-10-12T02:00:00.000Z",
  duration_minutes: 60,
  status: "completed",
  mode: "online",
  arrived_at: null,
  departed_at: null,
  meeting_url: null,
  teacher_id: "t",
  teacher_name: "Maya Chen",
  report_id: null,
  report_status: null,
  draft_ready: false,
  time_zone: "Asia/Singapore",
  seat: "host",
};
const NOW = "2026-10-13T01:00:00.000Z";

describe("reportState — what my_online_lessons says about a lesson's report", () => {
  it("follows the app's report_status when a report exists", () => {
    expect(reportState({ ...base, report_id: "r", report_status: "published" })).toBe("published");
    expect(reportState({ ...base, report_id: "r", report_status: "pending" })).toBe("pending");
    expect(reportState({ ...base, report_id: "r", report_status: "rejected" })).toBe("rejected");
  });

  it("says a draft is waiting only when there is no report", () => {
    expect(reportState({ ...base, draft_ready: true })).toBe("draft_ready");
    expect(reportState({ ...base, report_id: "r", report_status: "published", draft_ready: true })).toBe("published");
    expect(reportState(base)).toBe("none");
  });
});

describe("needsReport — the teacher's queue", () => {
  it("wants a report for a past hosted lesson with none, or one sent back", () => {
    expect(needsReport(base, NOW)).toBe(true);
    expect(needsReport({ ...base, report_id: "r", report_status: "rejected" }, NOW)).toBe(true);
  });

  it("does not want one for a reported, future, cancelled or non-host lesson", () => {
    expect(needsReport({ ...base, report_id: "r", report_status: "pending" }, NOW)).toBe(false);
    expect(needsReport({ ...base, report_id: "r", report_status: "published" }, NOW)).toBe(false);
    expect(needsReport({ ...base, effective_start: "2026-10-14T01:00:00.000Z", ends_at: "2026-10-14T02:00:00.000Z", status: "confirmed" }, NOW)).toBe(false);
    expect(needsReport({ ...base, status: "cancelled" }, NOW)).toBe(false);
    expect(needsReport({ ...base, seat: "observer" }, NOW)).toBe(false);
    expect(needsReport({ ...base, seat: "learner" }, NOW)).toBe(false);
  });
});

describe("signsReport — who publishes on submit (submit_report's v_signs_it)", () => {
  it("is the office, or a teacher the centre trusts to auto-approve", async () => {
    const { signsReport } = await import("@/lib/reports/signs");
    expect(signsReport({ role: "admin", report_auto_approve: false })).toBe(true);
    expect(signsReport({ role: "staff", report_auto_approve: false })).toBe(true);
    expect(signsReport({ role: "support", report_auto_approve: false })).toBe(true);
    expect(signsReport({ role: "teacher", report_auto_approve: true })).toBe(true);
    expect(signsReport({ role: "teacher", report_auto_approve: false })).toBe(false);
    expect(signsReport({ role: "parent", report_auto_approve: true })).toBe(false);
  });
});
