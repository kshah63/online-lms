import type { SessionStatus } from "@/lib/types";

// ============================================================================
// The lesson room's two decisions that do not need React, kept pure so they
// are unit-tested (tests/room-logic.test.ts): when a lesson is over, and when
// an embed event proves the student is in the room (plan decision e).
// ============================================================================

export type EndedStatus = "completed" | "no_show" | "cancelled";

/** A status after which the room shows the ended card and unmounts its Space. */
export function isEndedStatus(status: SessionStatus | string | null | undefined): status is EndedStatus {
  return status === "completed" || status === "no_show" || status === "cancelled";
}

export interface EmbedPresenceEvent {
  type: string;
  detail: Record<string, unknown> | null;
}

/**
 * Does this embed event prove the STUDENT is present?
 *  - Host view: `participant_join` whose id is the student's Pencil id; else
 *    `participantupdate.count >= 2`. The count stays a trigger because a
 *    student who arrives first (lesson links carry no skipCallHostCheck, so
 *    they wait on the board) may never produce a `participant_join` in the
 *    teacher's embed. Cost: a teacher's own whiteboard-only iPad could count
 *    as the second participant if `count` counts devices (asked of Pencil).
 *  - Student view: anyone else's `participant_join`, never the student's own
 *    id (their "use this device for writing" iPad), or the same count rule.
 *    The student's clock is local only, so a miss here is cosmetic.
 */
export function embedEventShowsStudent(
  evt: EmbedPresenceEvent,
  viewer: { hostView: boolean; studentPencilUserId: string | null },
): boolean {
  const detail = evt.detail ?? {};
  if (evt.type === "participant_join") {
    const id = typeof detail.id === "string" ? detail.id : null;
    if (viewer.hostView) return id !== null && viewer.studentPencilUserId !== null && id === viewer.studentPencilUserId;
    return id === null || id !== viewer.studentPencilUserId;
  }
  if (evt.type === "participantupdate") {
    const raw = detail.count;
    const count = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(count) && count >= 2;
  }
  return false;
}
