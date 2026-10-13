import { demoCourseTopics, demoCourses } from "@/lib/demo/data";
import type { SyllabusTopic } from "@/lib/bank/types";

// ============================================================================
// syllabus_topics, as the demo holds them: IGCSE Mathematics was seeded from
// its course_topics (course_topic_id set) and gained one hand-added topic and
// one deactivated one; SAT Math Prep has not been seeded yet, so its editor
// starts from the empty state. Physics is outside the in-charge's room.
// ============================================================================

const [IGCSE, SAT] = demoCourses;

/** The demo course_topics have no ids of their own; the seed keys them by label. */
export function demoCourseTopicId(courseId: string, label: string): string {
  const index = demoCourseTopics.filter((t) => t.course_id === courseId).findIndex((t) => t.label === label);
  return `60000000-0000-0000-0000-${courseId.slice(-4)}0000${String(index + 1).padStart(4, "0")}`;
}

export const demoSyllabusTopics: SyllabusTopic[] = [
  topic("50000000-0000-0000-0000-000000000001", IGCSE.id, "Quadratic equations", 10, demoCourseTopicId(IGCSE.id, "Quadratic equations")),
  topic("50000000-0000-0000-0000-000000000002", IGCSE.id, "Completing the square", 20, demoCourseTopicId(IGCSE.id, "Completing the square")),
  topic("50000000-0000-0000-0000-000000000003", IGCSE.id, "Trigonometry — sine rule", 30, demoCourseTopicId(IGCSE.id, "Trigonometry — sine rule")),
  topic("50000000-0000-0000-0000-000000000004", IGCSE.id, "Functions and graphs", 40, demoCourseTopicId(IGCSE.id, "Functions and graphs")),
  topic("50000000-0000-0000-0000-000000000005", IGCSE.id, "Number — primes and factors", 50, null),
  { ...topic("50000000-0000-0000-0000-000000000006", IGCSE.id, "Surds (moved to Sec 4)", 60, null), is_active: false },
];

void SAT;

function topic(id: string, courseId: string, label: string, sortOrder: number, courseTopicId: string | null): SyllabusTopic {
  return { id, course_id: courseId, label, parent_id: null, sort_order: sortOrder, course_topic_id: courseTopicId, is_active: true };
}

/** seed_syllabus_from_course_topics, as the demo answers it: one row per course topic not yet seeded. */
export function demoSeedSyllabus(courseId: string, existing: SyllabusTopic[]): SyllabusTopic[] {
  const have = new Set(existing.map((t) => t.course_topic_id).filter(Boolean));
  const next = existing.reduce((m, t) => Math.max(m, t.sort_order), 0);
  return demoCourseTopics
    .filter((t) => t.course_id === courseId)
    .map((t, i) => ({ t, ctid: demoCourseTopicId(courseId, t.label), i }))
    .filter(({ ctid }) => !have.has(ctid))
    .map(({ t, ctid, i }) => ({
      id: `50000000-0000-0000-0000-${courseId.slice(-4)}${String(i + 1).padStart(8, "0")}`,
      course_id: courseId,
      label: t.label,
      parent_id: null,
      sort_order: next + (i + 1) * 10,
      course_topic_id: ctid,
      is_active: true,
    }));
}
