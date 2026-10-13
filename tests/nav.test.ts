import { describe, expect, it } from "vitest";
import { navForRole, navIsActive } from "@/lib/nav";
import { ROLES } from "@/lib/types";

describe("navForRole — the sidebar per mv-app role", () => {
  it("gives the office the board, coaching QA, follow-ups and the question bank", () => {
    for (const role of ["admin", "staff", "support"] as const) {
      expect(navForRole(role).map((n) => n.label)).toEqual(["Board", "Coaching QA", "Follow-ups", "Question bank"]);
    }
  });

  it("gives a teacher today, reports and coaching", () => {
    expect(navForRole("teacher").map((n) => n.href)).toEqual(["/teacher", "/teacher/reports", "/teacher/coaching"]);
  });

  it("gives a family the dashboard, practice, progress and reports — and an ambassador only the dashboard", () => {
    expect(navForRole("student").map((n) => n.href)).toEqual(["/home", "/home/practice", "/home/progress", "/home/reports"]);
    expect(navForRole("parent")).toEqual(navForRole("student"));
    expect(navForRole("ambassador").map((n) => n.href)).toEqual(["/home"]);
  });

  it("answers for every role and never links to a retired screen", () => {
    for (const role of ROLES) {
      for (const item of navForRole(role)) expect(item.href).not.toMatch(/homework|people|courses|sessions|availability/);
    }
  });

  it("matches index routes exactly and the rest by prefix", () => {
    const [today, reports] = navForRole("teacher");
    expect(navIsActive(today!, "/teacher")).toBe(true);
    expect(navIsActive(today!, "/teacher/reports")).toBe(false);
    expect(navIsActive(reports!, "/teacher/reports/abc")).toBe(true);
  });
});
