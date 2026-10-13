// ============================================================================
// Session → follow-ups: the PURE half. What the model returns is validated,
// deduplicated against items already open for the student, and given the
// owner/action it needs. Nothing here touches the network.
// ============================================================================

import { z } from "zod";

export type FollowupKind =
  | "win" // something worth sharing with the parent
  | "concern" // wellbeing, tiredness, distraction, repeated struggle
  | "misconception" // a specific error pattern that keeps recurring
  | "logistics" // holiday, wants a different time, clash
  | "exam_upcoming" // a test or exam the student mentioned
  | "ask_to_relay" // "tell my mum …"
  | "tech_issue"; // audio, camera, device trouble

export type FollowupAction =
  | "share_with_parent" // post in the family thread (teacher reviews first)
  | "call_parent" // staff should speak to the parent
  | "note_for_next_lesson" // a standing note for the teacher
  | "staff_task"; // internal to-do (reschedule, check equipment)

export type FollowupPriority = "low" | "normal" | "high";

export interface ExtractedFollowup {
  kind: FollowupKind;
  action: FollowupAction;
  priority: FollowupPriority;
  title: string;
  detail: string;
  quote: string | null;
  at: string | null; // "mm:ss"
  suggested_parent_message: string | null;
  due_in_days: number;
}

export const FOLLOWUP_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["win", "concern", "misconception", "logistics", "exam_upcoming", "ask_to_relay", "tech_issue"] },
            action: { type: "string", enum: ["share_with_parent", "call_parent", "note_for_next_lesson", "staff_task"] },
            priority: { type: "string", enum: ["low", "normal", "high"] },
            title: { type: "string" },
            detail: { type: "string" },
            quote: { type: ["string", "null"] },
            at: { type: ["string", "null"] },
            suggested_parent_message: { type: ["string", "null"] },
            due_in_days: { type: "integer" },
          },
          required: ["kind", "action", "priority", "title", "detail", "quote", "at", "suggested_parent_message", "due_in_days"],
        },
      },
      nothing_notable: { type: "boolean" },
    },
    required: ["items", "nothing_notable"],
  },
};

const RawItem = z.object({
  kind: z.enum(["win", "concern", "misconception", "logistics", "exam_upcoming", "ask_to_relay", "tech_issue"]),
  action: z.enum(["share_with_parent", "call_parent", "note_for_next_lesson", "staff_task"]),
  priority: z.enum(["low", "normal", "high"]),
  title: z.string(),
  detail: z.string(),
  quote: z.string().nullable().default(null),
  at: z.string().nullable().default(null),
  suggested_parent_message: z.string().nullable().default(null),
  due_in_days: z.number().default(3),
});
export const RawFollowups = z.object({ items: z.array(RawItem), nothing_notable: z.boolean().default(false) });

/** Default owner-facing deadlines by priority, in days. */
export const DUE_DAYS: Record<FollowupPriority, number> = { high: 1, normal: 3, low: 7 };

function normaliseTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Two titles are "the same" when one contains the other or they share most words. */
export function similarTitles(a: string, b: string): boolean {
  const x = normaliseTitle(a);
  const y = normaliseTitle(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wx = new Set(x.split(" ").filter((w) => w.length > 3));
  const wy = new Set(y.split(" ").filter((w) => w.length > 3));
  if (wx.size === 0 || wy.size === 0) return false;
  let shared = 0;
  for (const w of wx) if (wy.has(w)) shared++;
  return shared / Math.min(wx.size, wy.size) >= 0.6;
}

/**
 * Validate and tidy. Rules applied regardless of what the model said:
 * - a concern about wellbeing is never auto-shared; it goes to a call.
 * - share_with_parent always carries a suggested message.
 * - deadlines follow priority unless the model gave a sooner one.
 * - items already open for this student (by title) are dropped.
 */
export function parseFollowups(raw: unknown, openTitles: string[] = []): { items: ExtractedFollowup[]; errors: string[] } {
  const parsed = RawFollowups.safeParse(raw);
  if (!parsed.success) return { items: [], errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };

  const out: ExtractedFollowup[] = [];
  for (const it of parsed.data.items) {
    const title = it.title.trim();
    const detail = it.detail.trim();
    if (!title || !detail) continue;
    if (openTitles.some((t) => similarTitles(t, title))) continue;
    if (out.some((o) => similarTitles(o.title, title))) continue;

    let action = it.action;
    let priority = it.priority;
    if (it.kind === "concern") {
      action = "call_parent";
      if (priority === "low") priority = "normal";
    }
    if (it.kind === "exam_upcoming" && priority === "low") priority = "normal";
    if (it.kind === "misconception" && action === "share_with_parent") action = "note_for_next_lesson";

    const suggested = action === "share_with_parent" ? (it.suggested_parent_message?.trim() || detail) : it.suggested_parent_message?.trim() || null;
    const due = Math.max(1, Math.min(DUE_DAYS[priority], Math.round(it.due_in_days || DUE_DAYS[priority])));

    out.push({
      kind: it.kind,
      action,
      priority,
      title,
      detail,
      quote: it.quote?.trim() || null,
      at: it.at && /^\d{1,2}:\d{2}$/.test(it.at.trim()) ? it.at.trim() : null,
      suggested_parent_message: suggested,
      due_in_days: due,
    });
  }
  const order: Record<FollowupPriority, number> = { high: 0, normal: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return { items: out, errors: [] };
}

// --- heuristic fallback (no API key) --------------------------------------

const EXAM = /\b(exam|test|assessment|mock|paper|quiz)\b.*\b(next|this|tomorrow|on|coming|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const CONFUSED = /\b(don'?t get|don'?t understand|confused|lost|stuck|no idea)\b/i;
const TIRED = /\b(tired|sleepy|didn'?t sleep|headache|sick|unwell)\b/i;
const LOGISTICS = /\b(holiday|travelling|away|can'?t make|change (the )?time|move (the )?lesson|reschedule)\b/i;
const TECH = /\b(can'?t hear|cannot hear|can'?t see|lag|frozen|audio|camera|mic|internet)\b/i;
const RELAY = /\b(tell my (mum|mom|dad|parents|mother|father))\b/i;

/** Transcript-keyword fallback so the pipeline still produces items without a key. */
export function heuristicFollowups(
  segments: { speaker: "teacher" | "student"; text: string; start_ms: number }[],
  openTitles: string[] = [],
): ExtractedFollowup[] {
  const items: ExtractedFollowup[] = [];
  const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  let confusionCount = 0;
  for (const s of segments) {
    if (s.speaker !== "student") continue;
    const at = fmt(s.start_ms);
    if (EXAM.test(s.text)) items.push({ kind: "exam_upcoming", action: "staff_task", priority: "normal", title: "Student mentioned an upcoming test", detail: s.text, quote: s.text, at, suggested_parent_message: null, due_in_days: 3 });
    if (TIRED.test(s.text)) items.push({ kind: "concern", action: "call_parent", priority: "normal", title: "Student seemed unwell or tired", detail: s.text, quote: s.text, at, suggested_parent_message: null, due_in_days: 3 });
    if (LOGISTICS.test(s.text)) items.push({ kind: "logistics", action: "staff_task", priority: "normal", title: "Scheduling change mentioned", detail: s.text, quote: s.text, at, suggested_parent_message: null, due_in_days: 3 });
    if (TECH.test(s.text)) items.push({ kind: "tech_issue", action: "staff_task", priority: "low", title: "Tech trouble during the lesson", detail: s.text, quote: s.text, at, suggested_parent_message: null, due_in_days: 7 });
    if (RELAY.test(s.text)) items.push({ kind: "ask_to_relay", action: "share_with_parent", priority: "normal", title: "Student asked for something to be passed on", detail: s.text, quote: s.text, at, suggested_parent_message: s.text, due_in_days: 3 });
    if (CONFUSED.test(s.text)) confusionCount++;
  }
  if (confusionCount >= 3) {
    items.push({ kind: "misconception", action: "note_for_next_lesson", priority: "normal", title: "Repeated confusion during the lesson", detail: `The student said they were stuck or confused ${confusionCount} times.`, quote: null, at: null, suggested_parent_message: null, due_in_days: 3 });
  }
  return parseFollowups({ items, nothing_notable: items.length === 0 }, openTitles).items;
}
