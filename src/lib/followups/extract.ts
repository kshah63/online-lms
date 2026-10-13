import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { captureError } from "@/lib/observability";
import type { TranscriptSegment } from "@/lib/coaching/metrics";
import { FOLLOWUP_FORMAT, heuristicFollowups, parseFollowups, type ExtractedFollowup } from "./extract-parse";

// ============================================================================
// After every lesson: what should the office know, and what should a parent
// hear? Wins to share, concerns to call about, logistics and exam dates to
// act on, and things the student asked to have passed on. Runs with the
// post-session analysis; items land as follow-ups with an owner and a
// deadline, and parent-facing ones are drafted for the teacher to approve.
// ============================================================================

export const followupAiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = "claude-opus-5-5";
const FALLBACK_MODEL = "claude-opus-4-8";

const SYSTEM = `You read the transcript of a 1-1 online maths lesson with a school-age student and list what the tuition centre should follow up on.

Only report things ACTUALLY in the transcript. Prefer fewer, specific items. Kinds:
- win: a genuine step forward a parent would like to hear (first time solving X alone, big effort).
- concern: wellbeing or engagement — tired, upset, distracted, repeatedly disengaged, says something worrying. These always go to a staff phone call, never an automatic message.
- misconception: an error pattern that recurred (sign errors, dividing by the wrong side). Action note_for_next_lesson.
- logistics: holidays, wanting a different time, clashes, missed-lesson reasons. Action staff_task.
- exam_upcoming: any test, exam, mock, assessment the student mentions with a time. Action staff_task, priority normal or high if within a week.
- ask_to_relay: the student asks for something to be told to a parent. Action share_with_parent.
- tech_issue: audio/camera/device trouble that cost lesson time. Action staff_task.
For share_with_parent write suggested_parent_message as a warm, plain two-sentence message from the teacher to the parent, first person, naming the student by first name. quote is a short verbatim excerpt (max 20 words); at is the [mm:ss] of that line. due_in_days: 1 for high, 3 for normal, 7 for low. If nothing is notable, return an empty list and nothing_notable true.`;

export interface ExtractFollowupsInput {
  segments: TranscriptSegment[];
  studentFirstName: string;
  course: string;
  /** Titles of follow-ups already open for this student, to avoid duplicates. */
  openTitles: string[];
  /** Optional one-paragraph summary of what was on the whiteboard. */
  notebookSummary?: string | null;
  useAi?: boolean;
}

export async function extractFollowups(input: ExtractFollowupsInput): Promise<{ items: ExtractedFollowup[]; source: "ai" | "heuristic" }> {
  if (!followupAiConfigured || input.useAi === false || input.segments.length === 0) {
    return { items: heuristicFollowups(input.segments, input.openTitles), source: "heuristic" };
  }
  const client = new Anthropic();
  const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  const transcript = input.segments.map((s) => `[${fmt(s.start_ms)}] ${s.speaker === "teacher" ? "Teacher" : "Student"}: ${s.text}`).join("\n");

  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Student: ${input.studentFirstName}. Course: ${input.course}.
${input.openTitles.length ? `Already being followed up (do not repeat): ${input.openTitles.join("; ")}\n` : ""}${input.notebookSummary ? `Whiteboard summary: ${input.notebookSummary}\n` : ""}
Transcript:
${transcript}`,
        },
      ],
      output_config: { format: FOLLOWUP_FORMAT, effort: "high" },
    });
    if (res.stop_reason === "refusal") return { items: heuristicFollowups(input.segments, input.openTitles), source: "heuristic" };
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (text) {
      const parsed = parseFollowups(JSON.parse(text), input.openTitles);
      if (parsed.errors.length === 0) return { items: parsed.items, source: "ai" };
    }
  } catch (err) {
    captureError(err, { where: "extractFollowups" });
  }
  return { items: heuristicFollowups(input.segments, input.openTitles), source: "heuristic" };
}
