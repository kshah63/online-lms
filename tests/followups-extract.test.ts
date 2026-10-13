import { describe, expect, it } from "vitest";
import { heuristicFollowups, parseFollowups, similarTitles } from "@/lib/followups/extract-parse";

describe("parseFollowups", () => {
  const item = (o: Partial<Record<string, unknown>> = {}) => ({
    kind: "win", action: "share_with_parent", priority: "normal", title: "Solved quadratics alone", detail: "First time unaided.",
    quote: "I did it!", at: "12:34", suggested_parent_message: null, due_in_days: 3, ...o,
  });

  it("applies policy: concerns go to a call, misconceptions to the next lesson, shares carry a message", () => {
    const r = parseFollowups({
      items: [
        item(),
        item({ kind: "concern", action: "share_with_parent", priority: "low", title: "Seemed exhausted", detail: "Yawning throughout." }),
        item({ kind: "misconception", action: "share_with_parent", title: "Sign errors when expanding", detail: "Three times." }),
      ],
      nothing_notable: false,
    });
    expect(r.errors).toEqual([]);
    const byTitle = Object.fromEntries(r.items.map((i) => [i.title, i]));
    expect(byTitle["Solved quadratics alone"]).toMatchObject({ action: "share_with_parent", suggested_parent_message: "First time unaided.", due_in_days: 3 });
    expect(byTitle["Seemed exhausted"]).toMatchObject({ kind: "concern", action: "call_parent", priority: "normal" });
    expect(byTitle["Sign errors when expanding"]).toMatchObject({ action: "note_for_next_lesson" });
  });
  it("drops duplicates of open items and within the batch, and sorts by priority", () => {
    const r = parseFollowups(
      { items: [item({ priority: "low" }), item({ title: "solved quadratics alone!" }), item({ title: "Exam next Friday", kind: "exam_upcoming", action: "staff_task", priority: "high", due_in_days: 5 })], nothing_notable: false },
      ["Exam next friday"],
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.title).toBe("Solved quadratics alone");
  });
  it("caps due dates by priority and validates timestamps", () => {
    const r = parseFollowups({ items: [item({ priority: "high", due_in_days: 9, at: "bad" })], nothing_notable: false });
    expect(r.items[0]).toMatchObject({ due_in_days: 1, at: null });
  });
  it("reports schema errors", () => {
    expect(parseFollowups({ items: [{ kind: "nope" }] }).errors.length).toBeGreaterThan(0);
  });
});

describe("similarTitles", () => {
  it("matches containment and shared-word overlap", () => {
    expect(similarTitles("Exam next Friday", "exam next friday!")).toBe(true);
    expect(similarTitles("Student mentioned an upcoming test", "Upcoming test mentioned by student")).toBe(true);
    expect(similarTitles("Holiday in June", "Sign errors")).toBe(false);
  });
});

describe("heuristicFollowups", () => {
  it("finds exam mentions, tiredness, logistics and repeated confusion in student speech only", () => {
    const seg = (speaker: "teacher" | "student", text: string, s: number) => ({ speaker, text, start_ms: s * 1000, end_ms: s * 1000 + 2000 });
    const items = heuristicFollowups([
      seg("student", "I have a maths test next Thursday", 60),
      seg("teacher", "I have a test next week too", 70),
      seg("student", "I'm so tired, I didn't sleep", 120),
      seg("student", "we're on holiday the week after", 180),
      seg("student", "I don't get it", 200),
      seg("student", "I'm confused", 210),
      seg("student", "no idea", 220),
    ]);
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["concern", "exam_upcoming", "logistics", "misconception"]);
    expect(items.find((i) => i.kind === "exam_upcoming")?.at).toBe("01:00");
    expect(items.find((i) => i.kind === "concern")?.action).toBe("call_parent");
  });
});
