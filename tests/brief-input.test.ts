import { describe, expect, it } from "vitest";
import { composeBrief } from "@/lib/brief/compose";
import { briefInputFrom } from "@/lib/brief/input";
import { DEMO_IDS, buildDemoLessonRoomState, buildDemoOnlineLessons, demoProfiles, demoReportDrafts, demoSessionReports } from "@/lib/demo/data";

const maya = demoProfiles.find((p) => p.id === DEMO_IDS.maya)!;
const LIVE = "20000000-0000-0000-0000-000000000002"; // Maya + Sofia, live now
const UNREPORTED = "20000000-0000-0000-0000-000000000006"; // Maya + Aarav, yesterday, draft only

describe("briefInputFrom — the brief from what the room can read", () => {
  it("takes the last published report on the student and the room state when the room is open", () => {
    const lesson = buildDemoOnlineLessons(maya).find((l) => l.session_id === LIVE)!;
    const state = buildDemoLessonRoomState(LIVE, maya);
    const lastReport = demoSessionReports.find((r) => r.student_id === DEMO_IDS.sofia)!;
    const input = briefInputFrom({ lesson, state, lastReport, lastDraft: null, moments: [{ at: "07:42", kind: "improvement", quote: "", comment: "Wait longer." }] });

    expect(input.student.first_name).toBe("Sofia");
    expect(input.student.grade).toBe("Grade 11");
    expect(input.course).toBe("SAT Math Prep");
    expect(input.last_report?.topic).toBe("Linear systems");
    expect(input.last_report?.topic_completed).toBe(false);
    expect(input.coaching_moments).toEqual([{ kind: "improvement", comment: "Wait longer." }]);

    const brief = composeBrief(input);
    expect(brief.headline).toContain("Sofia (Grade 11)");
    expect(brief.suggested_focus[0]).toBe("Finish Linear systems — systems with no solution.");
    expect(brief.sections.map((s) => s.title)).toEqual(["Today", "Last time", "For you, from last lesson"]);
  });

  it("falls back to the AI draft of the previous lesson when no report is visible, and says so", () => {
    const lesson = buildDemoOnlineLessons(maya).find((l) => l.session_id === UNREPORTED)!;
    const input = briefInputFrom({ lesson, state: null, lastReport: null, lastDraft: demoReportDrafts[UNREPORTED]!, moments: [] });
    expect(input.student.grade).toBeNull();
    expect(input.course).toBe("IGCSE Mathematics");
    expect(input.last_report?.topic).toBe("Quadratic equations");
    expect(input.last_report?.understanding).toBe(7);
    expect(input.last_report?.remarks).toMatch(/^\(AI draft, not yet submitted\)/);
  });

  it("invents nothing for a first lesson", () => {
    const lesson = buildDemoOnlineLessons(maya).find((l) => l.session_id === LIVE)!;
    const brief = composeBrief(briefInputFrom({ lesson, state: null, lastReport: null, lastDraft: null, moments: [] }));
    expect(brief.headline).toContain("first lesson on the platform");
    expect(brief.sections.map((s) => s.title)).toEqual(["Today"]);
  });
});
