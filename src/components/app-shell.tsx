"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, BookMarked, CalendarDays, ClipboardList, Clock, FileText, LayoutDashboard, ListChecks, LogOut, ShieldCheck, Sparkles } from "lucide-react";
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
import { signOut } from "@/lib/actions/auth";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { navForRole, navIsActive, type NavIcon } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { displayName, type Profile, type Role } from "@/lib/types";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  board: LayoutDashboard,
  sparkles: Sparkles,
  list: ListChecks,
  today: LayoutDashboard,
  reports: ClipboardList,
  dashboard: LayoutDashboard,
  progress: BarChart3,
  bank: BookMarked,
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  staff: "Staff",
  support: "Support",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
  ambassador: "Ambassador",
};

export function AppShell({
  profile,
  tz,
  demoMode,
  children,
}: {
  profile: Profile;
  /** The zone times are shown in (the profile's, else the centre's). */
  tz: string;
  demoMode: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const nav = navForRole(profile.role);
  const name = displayName(profile);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card/60 px-4 py-5 md:flex">
        <Link href="/" className="mb-7 flex items-center px-1">
          <BrandWordmark size={30} textClassName="text-[15px]" />
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = navIsActive(item, pathname);
            const Icon = item.icon === "reports" && profile.role !== "teacher" ? FileText : ICONS[item.icon];
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
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-lg bg-secondary/60 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Your time zone
          </div>
          <div className="text-sm font-medium">{tz.replace(/_/g, " ")}</div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          {/* mobile brand */}
          <Link href="/" className="flex items-center md:hidden">
            <BrandMark size={28} />
          </Link>

          <Clock12 tz={tz} />

          <div className="ml-auto flex items-center gap-2">
            {demoMode && (
              <Badge variant="warning" className="hidden sm:inline-flex">
                Demo mode
              </Badge>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar name={name} src={profile.avatar_url} size={32} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="font-semibold">{name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/settings/security">
                    <ShieldCheck className="h-4 w-4" />
                    Account security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={() => {
                    // Server action: clears the Supabase session (or the demo
                    // persona cookie) and redirects to /login.
                    void signOut();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  {demoMode ? "Switch persona" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {demoMode && (
          <div className="border-b bg-warning/10 px-4 py-2 text-center text-xs text-warning-foreground md:px-6">
            Running in <strong>demo mode</strong> with built-in data. Connect the MathVision Supabase project (see
            README) to go live. Mutations aren&rsquo;t persisted.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}

/** Live clock in the viewer's time zone. */
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
