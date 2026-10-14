// ============================================================================
// Which screens a lesson opens on. The room puts the notebook, the video rail
// and the activity panel side by side, and the owner's rule is that nobody
// joins a lesson from a phone: it opens on a laptop or a tablet. The rule is
// decided here, once, and the gate in the room reads it.
// ============================================================================

/** The narrowest viewport the room is laid out for. */
export const ROOM_MIN_WIDTH = 900;

/** A touch screen (coarse pointer) narrower than this is a phone held sideways, not a tablet. */
export const ROOM_MIN_WIDTH_TOUCH = 1024;

/** Whether a lesson may open on a screen this wide with this kind of pointer. */
export function lessonFitsScreen(width: number, coarsePointer: boolean): boolean {
  if (!Number.isFinite(width) || width < ROOM_MIN_WIDTH) return false;
  if (coarsePointer && width < ROOM_MIN_WIDTH_TOUCH) return false;
  return true;
}
