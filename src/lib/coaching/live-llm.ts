import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

// §7.2 (optional LLM pass): a periodic, rate-limited look at the last few
// minutes of transcript for a subtle, timely nudge the threshold rules miss.
// Uses a fast model — these fire mid-lesson, so latency matters more than depth
// (the deep analysis is the post-session Opus pass).

export const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

const SYSTEM = `You are a live coach for a 1-1 tutoring lesson, whispering privately to the TEACHER.
Read the last few minutes of transcript. If there is ONE timely, supportive, specific nudge that
would help right now, reply with it in 12 words or fewer, no quotes. If nothing needs saying, reply
exactly: NONE. Be encouraging, never harsh.

Look especially for cues the simple rules miss:
- An error the student made that the teacher moved past without correcting.
- A shallow or guessed answer the teacher accepted without probing the reasoning.
- Signs the student is frustrated, anxious, or disengaged (reassure / re-motivate).
- A missed chance to connect the idea to something concrete or to let the student lead.

Examples: "They erred on the sign — revisit that step." "They guessed — ask them to explain why."
"They sound discouraged — reassure them." "Let them attempt the next line themselves."`;

export async function liveCoachCue(segments: TranscriptSegment[]): Promise<string | null> {
  if (!aiConfigured || segments.length === 0) return null;
  const client = new Anthropic();
  const transcript = segments
    .map((s) => `${s.speaker === "teacher" ? "Teacher" : "Student"}: ${s.text}`)
    .join("\n");

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 40,
      system: SYSTEM,
      messages: [{ role: "user", content: transcript }],
    });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text?.trim() ?? "";
    if (!text || text.toUpperCase().startsWith("NONE")) return null;
    return text.replace(/^["']+|["']+$/g, "").slice(0, 120);
  } catch (e) {
    console.error("liveCoachCue failed:", e);
    return null;
  }
}
