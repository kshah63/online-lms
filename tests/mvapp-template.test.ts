import { describe, expect, it } from "vitest";
import {
  GP_OPTIONS,
  OTR_BANDS,
  normaliseGp,
  normaliseOtr,
  normalisePrevHw,
  normaliseUnderstanding,
  normaliseWrittenTests,
  testPercent,
  validateReportDraft,
  type SessionReportDraft,
} from "@/lib/reports/mvapp-template";

const base: SessionReportDraft = {
  topic: "Quadratics — completing the square",
  topic_completed: true,
  topics_not_done: null,
  understanding: 8,
  otr: 85,
  gp: 6.25,
  prev_hw: "Yes",
  homework: "Ex 4B 1-8",
  remarks: "Good session.",
  written_tests: [],
  has_upcoming_tests: false,
};

describe("mv-app report template", () => {
  it("has the portal's option lists", () => {
    expect(GP_OPTIONS[0]).toBe(7);
    expect(GP_OPTIONS[GP_OPTIONS.length - 1]).toBe(1);
    expect(GP_OPTIONS).toHaveLength(25);
    expect(OTR_BANDS[0]).toEqual({ lower: 95, label: "95% to 100%" });
    expect(OTR_BANDS).toHaveLength(19);
  });

  it("snaps GP to quarters and OTR to bands", () => {
    expect(normaliseGp(6.3)).toBe(6.25);
    expect(normaliseGp("5.9")).toBe(6);
    expect(normaliseGp(9)).toBe(7);
    expect(normaliseGp(null)).toBeNull();
    expect(normaliseOtr(83)).toBe(85);
    expect(normaliseOtr(0)).toBeNull();
    expect(normaliseOtr(120)).toBe(95);
    expect(normaliseUnderstanding(7.6)).toBe(8);
    expect(normaliseUnderstanding(0)).toBe(1);
  });

  it("maps loose homework phrases onto the nine options", () => {
    expect(normalisePrevHw("yes")).toBe("Yes");
    expect(normalisePrevHw("Partly done")).toBe("Partially Done");
    expect(normalisePrevHw("mostly complete")).toBe("Most of it Done");
    expect(normalisePrevHw("none was given")).toBe("No Homework Given");
    expect(normalisePrevHw("forgot his exercise book")).toBe("Did Not Bring Exercise Book");
    expect(normalisePrevHw("not done")).toBe("Not Done");
    expect(normalisePrevHw("sent it by whatsapp, done")).toBe("Done And Sent Through Email/Skype/Whatsapp");
    expect(normalisePrevHw("unclear")).toBeNull();
  });

  it("derives written-test percentages from marks only", () => {
    expect(testPercent(17, 20)).toBe(85);
    expect(testPercent(21, 20)).toBeNull();
    expect(normaliseWrittenTests([{ name: " Topic test ", score: 17, out_of: 20 }, { name: "", score: 1, out_of: 2 }])).toEqual([
      { name: "Topic test", score: 17, out_of: 20, percent: 85 },
    ]);
  });

  it("validates what submit_report would refuse", () => {
    expect(validateReportDraft(base, { signs: true })).toEqual([]);
    expect(validateReportDraft({ ...base, gp: null }, { signs: true })).toContain("A report needs a GP before it goes to the family.");
    expect(validateReportDraft(base, { signs: false })).toContain("The GP is set by the in-charge for this report.");
    expect(validateReportDraft({ ...base, gp: null }, { signs: false })).toEqual([]);
    expect(validateReportDraft({ ...base, topic: " " }, { signs: true })).toContain("A report needs the topic that was taught.");
    expect(validateReportDraft({ ...base, understanding: 11 }, { signs: true }).length).toBe(1);
    expect(validateReportDraft({ ...base, topic_completed: true, topics_not_done: "surds" }, { signs: true }).length).toBe(1);
    expect(validateReportDraft({ ...base, otr: 83 }, { signs: true }).length).toBe(1);
  });
});
