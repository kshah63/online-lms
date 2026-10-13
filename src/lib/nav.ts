import type { Role } from "@/lib/types";

// ============================================================================
// What each mv-app role sees in the sidebar. The office (admin, in-charges and
// support) looks across rooms; a teacher at their own day; a family at the
// child's. Ambassadors have nothing in the room.
// ============================================================================

export type NavIcon = "board" | "sparkles" | "list" | "today" | "reports" | "dashboard" | "progress";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

const OFFICE_NAV: NavItem[] = [
  { href: "/admin", label: "Board", icon: "board" },
  { href: "/admin/coaching", label: "Coaching QA", icon: "sparkles" },
  { href: "/admin/followups", label: "Follow-ups", icon: "list" },
];

const TEACHER_NAV: NavItem[] = [
  { href: "/teacher", label: "Today", icon: "today" },
  { href: "/teacher/reports", label: "Reports", icon: "reports" },
  { href: "/teacher/coaching", label: "Coaching", icon: "sparkles" },
];

const FAMILY_NAV: NavItem[] = [
  { href: "/home", label: "Dashboard", icon: "dashboard" },
  { href: "/home/progress", label: "Progress", icon: "progress" },
  { href: "/home/reports", label: "Reports", icon: "reports" },
];

export function navForRole(role: Role): NavItem[] {
  switch (role) {
    case "admin":
    case "staff":
    case "support":
      return OFFICE_NAV;
    case "teacher":
      return TEACHER_NAV;
    case "student":
    case "parent":
      return FAMILY_NAV;
    case "ambassador":
      return [FAMILY_NAV[0]!];
  }
}

/** The index routes match exactly; everything else matches by prefix. */
export function navIsActive(item: NavItem, pathname: string): boolean {
  const indexRoutes = ["/admin", "/teacher", "/home"];
  return pathname === item.href || (!indexRoutes.includes(item.href) && pathname.startsWith(item.href));
}
