import "server-only";
import { demoCourses, demoProfiles, demoRecordingOptOuts, demoSpaceId, findDemoSpace } from "@/lib/demo/data";
import type { PencilSpace, PencilUser, Profile } from "@/lib/types";

// ============================================================================
// Deterministic stand-ins used whenever `!pencilConfigured || isDemoMode`
// (see client.ts `pencilLive`). Nothing here touches the network or the DB.
// Space ids follow `space-<student>-<course>`; the UI renders `status: 'mock'`
// Spaces (no `pencil_space_id`, no `link`) as <MockSpacePanel>, and a join
// answered with `configured: false` must never be turned into an iframe src.
// ============================================================================

export const MOCK_USER_PREFIX = "mock-user-";
/** A reserved, never-resolving host so a mock "Space link" can't open anything real. */
export const MOCK_SPACE_ORIGIN = "https://mock.pencilspaces.invalid";

/** `mock-user-<profile id>` — stable per profile so participant_join gating works in demo. */
export function mockPencilUserId(profileId: string): string {
  return `${MOCK_USER_PREFIX}${profileId}`;
}

export function isMockPencilUserId(pencilUserId: string | null | undefined): boolean {
  return typeof pencilUserId === "string" && pencilUserId.startsWith(MOCK_USER_PREFIX);
}

export function mockSpaceId(studentId: string, courseId: string): string {
  return demoSpaceId(studentId, courseId);
}

function firstName(name: string | undefined, fallback: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || fallback;
}

/** A pencil_users-shaped row for a profile that was never sent to Pencil. */
export function mockPencilUser(profile: Pick<Profile, "id" | "display_name" | "role">): PencilUser {
  return {
    profile_id: profile.id,
    pencil_user_id: mockPencilUserId(profile.id),
    pencil_email: null,
    pencil_name: profile.role === "student" ? firstName(profile.display_name, "Student") : profile.display_name,
    created_at: new Date(0).toISOString(),
  };
}

export interface MockSpaceInput {
  studentId: string;
  courseId: string;
  /** Becomes the (only) host when the pair is not in the demo dataset. */
  teacherId?: string | null;
  /** Title hints for non-demo (real UUID) pairs; demo pairs resolve their own. */
  courseName?: string | null;
  studentName?: string | null;
  /** Overrides the demoRecordingOptOuts lookup (real DB flag when Supabase is on but Pencil isn't). */
  optedOut?: boolean;
}

/**
 * A pencil_spaces-shaped row with `status: 'mock'`. Uses the demo dataset's
 * row when the pair exists there (so hosts match demoTeacherCourse), otherwise
 * synthesizes one. `recording_disabled` mirrors the opt-out flag so the join
 * hard stop (`recordingPolicyBlocksJoin`) never fires for a mock Space.
 */
export function mockSpace(input: MockSpaceInput): PencilSpace {
  const optedOut =
    input.optedOut ?? demoRecordingOptOuts.some((o) => o.student_id === input.studentId);
  const now = new Date().toISOString();
  const demo = findDemoSpace(input.studentId, input.courseId);
  if (demo) {
    return {
      ...demo,
      host_profile_ids: input.teacherId && !demo.host_profile_ids.includes(input.teacherId)
        ? [...demo.host_profile_ids, input.teacherId]
        : [...demo.host_profile_ids],
      participant_profile_ids: [...demo.participant_profile_ids],
      recording_disabled: optedOut,
      recording_verified_at: optedOut ? now : null,
    };
  }

  const course = demoCourses.find((c) => c.id === input.courseId);
  const student = demoProfiles.find((p) => p.id === input.studentId);
  const courseName = input.courseName ?? course?.name ?? "Course";
  const studentFirst = firstName(input.studentName ?? student?.display_name, "Student");
  return {
    id: mockSpaceId(input.studentId, input.courseId),
    student_id: input.studentId,
    course_id: input.courseId,
    external_id: `${input.courseId}:${input.studentId}`,
    pencil_space_id: null,
    link: null,
    title: `${courseName} · ${studentFirst}`,
    host_profile_ids: input.teacherId ? [input.teacherId] : [],
    participant_profile_ids: [input.studentId],
    hosts_synced_at: null,
    recording_disabled: optedOut,
    recording_verified_at: optedOut ? now : null,
    status: "mock",
    created_at: now,
    updated_at: now,
  };
}

/** The pretend Space URL a mock join is built on (never resolves). */
export function mockSpaceLink(space: Pick<PencilSpace, "id">): string {
  return `${MOCK_SPACE_ORIGIN}/spaces/${encodeURIComponent(space.id)}`;
}

/**
 * What `POST /api/lesson/[id]/space` (and the mobile route) return when Pencil
 * is mocked. `configured: false` tells <SpaceStage> to render <MockSpacePanel>
 * instead of an iframe; `studentPencilUserId` is what "Simulate student joins"
 * should feed into the same `participant_join` handler the live iframe uses.
 */
export interface MockSpaceJoin {
  configured: false;
  mock: true;
  mode: "mock";
  /** Why it's mocked — copy for the panel badge. */
  reason: "demo" | "unconfigured";
  space: PencilSpace;
  studentPencilUserId: string;
  teacherPencilUserId: string | null;
  optedOut: boolean;
  /** Where to send people when the lesson can't run in Pencil (resolveFallbackUrl). */
  fallbackJoinUrl: string | null;
}

export function mockSpaceJoin(
  input: MockSpaceInput & { reason: MockSpaceJoin["reason"]; fallbackJoinUrl?: string | null },
): MockSpaceJoin {
  const space = mockSpace(input);
  return {
    configured: false,
    mock: true,
    mode: "mock",
    reason: input.reason,
    space,
    studentPencilUserId: mockPencilUserId(input.studentId),
    teacherPencilUserId: input.teacherId ? mockPencilUserId(input.teacherId) : null,
    optedOut: space.recording_disabled,
    fallbackJoinUrl: input.fallbackJoinUrl ?? null,
  };
}
