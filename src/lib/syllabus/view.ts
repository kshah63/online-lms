import type { CourseProgressSummary, TopicProgress } from "./progress";

/** What the progress dashboard renders — assembled by the data layer. */
export interface ProgressView {
  student: { id: string; first_name: string };
  course: { id: string; name: string };
  generated_at: string;
  summary: CourseProgressSummary;
  topics: { id: string; label: string; progress: TopicProgress }[];
  /** Practice items per week, oldest first (8 weeks). */
  weekly: { week_start: string; items: number }[];
  /** Accuracy over the current and previous 8-week windows, 0..1 or null. */
  accuracy: { current: number | null; previous: number | null; items: number };
  attendance: { attended: number; booked: number; weeks: number };
  tests: { name: string; at: string; score: number; out_of: number; topic_label: string | null; flagged: boolean }[];
}
