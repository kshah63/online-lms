import type { SyllabusTopic, SyllabusTopicInput } from "./types";

// ============================================================================
// The syllabus editor's ordering, pure: every change is expressed as the
// upsert_syllabus_topic calls that make it so, in order. Unit-tested.
// ============================================================================

/** Active topics first in sort_order, then the deactivated ones, each in sort_order then label. */
export function orderTopics(topics: SyllabusTopic[]): SyllabusTopic[] {
  return [...topics].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

/** The sort_order a new topic takes: after the last one. */
export function nextSortOrder(topics: SyllabusTopic[]): number {
  return topics.reduce((m, t) => Math.max(m, t.sort_order), 0) + 10;
}

export function toInput(t: SyllabusTopic): SyllabusTopicInput {
  return { id: t.id, label: t.label, parent_id: t.parent_id, sort_order: t.sort_order, is_active: t.is_active };
}

/**
 * Move an active topic one place up or down among the active ones. Returns the
 * upserts that make it so: the two neighbours with their sort_orders swapped,
 * or none when it is already at the end. When any two active topics share a
 * sort_order a swap could not change the order on screen, so the whole active
 * list is renumbered in tens in its new order instead.
 */
export function moveTopic(topics: SyllabusTopic[], id: string, direction: "up" | "down"): SyllabusTopicInput[] {
  const active = orderTopics(topics).filter((t) => t.is_active);
  const index = active.findIndex((t) => t.id === id);
  if (index < 0) return [];
  const other = direction === "up" ? index - 1 : index + 1;
  if (other < 0 || other >= active.length) return [];
  const a = active[index]!;
  const b = active[other]!;
  const distinct = new Set(active.map((t) => t.sort_order)).size === active.length;
  if (distinct) {
    return [
      { ...toInput(a), sort_order: b.sort_order },
      { ...toInput(b), sort_order: a.sort_order },
    ];
  }
  const reordered = [...active];
  reordered[index] = b;
  reordered[other] = a;
  return reordered.map((t, i) => ({ ...toInput(t), sort_order: (i + 1) * 10 })).filter((u, i) => u.sort_order !== reordered[i]!.sort_order || u.id === a.id || u.id === b.id);
}

/** Apply an upsert to the list in memory (the demo's answer, and the editor's optimistic state). */
export function applyUpsert(topics: SyllabusTopic[], courseId: string, input: SyllabusTopicInput, newId: string): SyllabusTopic[] {
  if (input.id && topics.some((t) => t.id === input.id)) {
    return topics.map((t) => (t.id === input.id ? { ...t, label: input.label, parent_id: input.parent_id, sort_order: input.sort_order, is_active: input.is_active } : t));
  }
  return [...topics, { id: input.id ?? newId, course_id: courseId, label: input.label, parent_id: input.parent_id, sort_order: input.sort_order, course_topic_id: null, is_active: input.is_active }];
}
