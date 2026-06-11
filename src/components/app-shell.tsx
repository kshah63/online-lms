"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Sparkles,
  Users,
} from "lucide-react";
import { DateTime } from "luxon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Profile, Role } from "@/lib/types";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const NAV: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", label: "Schedule board", icon: LayoutDashboard },
    { href: "/admin/sessions", label: "Sessions", icon: CalendarClock },
    { href: "/admin/followups", label: "Follow-ups", icon: ListChecks },
    { href: "/admin/people", label: "People", icon: Users },
    { href: "/admin/coaching", label: "Coaching QA", icon: Sparkles },
  ],
  teacher: [
    { href: "/teacher", label: "Today", icon: LayoutDashboard },
    { href: "/teacher/reports", label: "Reports", icon: ClipboardList },
    { href: "/teacher/homework", label: "Homework", icon: ClipboardCheck },
    { href: "/teacher/coaching", label: "Coaching", icon: Sparkles },
    { href: "/teacher/availability", label: "Availability", icon: Clock },
  ],
  student: [
    { href: "/home", label: "Dashboard", icon: LayoutDashboard },
    { href: "/home/homework", label: "Homework", icon: ClipboardCheck },
    { href: "/home/reports", label: "Reports", icon: FileText },
  ],
  parent: [
    { href: "/home", label: "Dashboard", icon: LayoutDashboard },
    { href: "/home/homework", label: "Homework", icon: ClipboardCheck },
    { href: "/home/reports", label: "Reports", icon: FileText },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrator",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

export function AppShell({
  profile,
  demoMode,
  children,
}: {
  profile: Profile;
  demoMode: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const nav = NAV[profile.role];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card/60 px-4 py-5 md:flex">
        <Link href="/" className="mb-7 flex items-center gap-2.5 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Lessons</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const indexRoutes = ["/admin", "/teacher", "/home"];
            const active =
              pathname === item.href ||
              (!indexRoutes.includes(item.href) && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-lg bg-secondary/60 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Your timezone
          </div>
          <div className="text-sm font-medium">{profile.timezone.replace(/_/g, " ")}</div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          {/* mobile brand */}
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" />
            </span>
          </Link>

          <Clock12 tz={profile.timezone} />

          <div className="ml-auto flex items-center gap-2">
            {demoMode && (
              <Badge variant="warning" className="hidden sm:inline-flex">
                Demo mode
              </Badge>
            )}
            <button className="relative rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar name={profile.display_name} src={profile.avatar_url} size={32} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="font-semibold">{profile.display_name}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {ROLE_LABEL[profile.role]} · {profile.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/login">
                    <LogOut className="h-4 w-4" />
                    {demoMode ? "Switch persona" : "Sign out"}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {demoMode && (
          <div className="border-b bg-warning/10 px-4 py-2 text-center text-xs text-warning-foreground md:px-6">
            Running in <strong>demo mode</strong> with built-in data. Connect a Supabase project (see README) to go live.
            Mutations aren&rsquo;t persisted.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}

/** Live clock in the viewer's timezone. */
function Clock12({ tz }: { tz: string }) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(DateTime.now().setZone(tz).toFormat("ccc d LLL · h:mm a"));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [tz]);
  return (
    <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
      <Clock className="h-4 w-4" />
      <span className="tabular-nums">{now}</span>
    </div>
  );
}
