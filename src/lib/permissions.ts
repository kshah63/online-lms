import type { Role, Seat } from "@/lib/types";

// ============================================================================
// The ONE place the room maps an mv-app role (plus the seat SQL gave it) onto
// what a screen may show. Seats themselves are decided in the database by
// room_access / lesson_room_state; nothing here widens them.
// ============================================================================

/** The materials portal's acting roles (material repo: lib/api/auth.ts ACTING_ROLES). */
export type MaterialsRole = "admin" | "in_charge" | "teacher" | "student";

/**
 * Who the materials panel acts as for a lesson, or null for no panel at all.
 *
 *   admin                 → admin
 *   staff hosting         → teacher (a staff member who teaches is a host)
 *   staff observing       → in_charge
 *   teacher hosting       → teacher
 *   student learning      → student
 *   anyone with no seat, support, parent, ambassador → null
 */
export function canSeeMaterialsAs(role: Role, seat: Seat | null): MaterialsRole | null {
  if (!seat) return null;
  switch (role) {
    case "admin":
      return "admin";
    case "staff":
      return seat === "host" ? "teacher" : "in_charge";
    case "teacher":
      return seat === "host" ? "teacher" : null;
    case "student":
      return seat === "learner" ? "student" : null;
    default:
      return null;
  }
}

/** The office: admin, in-charges (staff) and support. They land on /admin. */
export function isOffice(role: Role): boolean {
  return role === "admin" || role === "staff" || role === "support";
}

/** A family account: a parent or a student. They land on /home. */
export function isFamily(role: Role): boolean {
  return role === "parent" || role === "student";
}

export const OFFICE_ROLES: readonly Role[] = ["admin", "staff", "support"];
