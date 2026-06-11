import Link from "next/link";
import { CalendarClock, CalendarX2, Radio, UserRoundX, Users, X } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/data/auth";
import { getSessionsForDay } from "@/lib/data/sessions";
import type { SessionView } from "@/lib/types";

const FILTERS = {
  live: {
    label: "Live now",
    match: (s: SessionView) => s.status === "in_progress",
    empty: "No lessons are live right now.",
  },
  unassigned: {
    label: "Unassigned",
    match: (s: SessionView) => !s.teacher_id,
    empty: "Every lesson on this day has a teacher assigned.",
  },
  no_show: {
    label: "No-shows",
    match: (s: SessionView) => s.status === "no_show",
    empty: "No missed lessons on this day.",
  },
} as const;

type FilterKey = keyof typeof FILTERS;

export default async function AdminBoardPage({
  searchParams,
}: {
  searchParams: { date?: string; filter?: string };
}) {
  const admin = await requireRole("admin");
  const tz = admin.timezone;

  const dayISO = searchParams.date ?? DateTime.now().setZone(tz).toISODate()!;
  const sessions = await getSessionsForDay(tz, dayISO);

  const filter = (searchParams.filter && searchParams.filter in FILTERS
    ? searchParams.filter
    : undefined) as FilterKey | undefined;

  const liveNow = sessions.filter(FILTERS.live.match).length;
  const unassigned = sessions.filter(FILTERS.unassigned.match).length;
  const noShows = sessions.filter(FILTERS.no_show.match).length;

  const visible = filter ? sessions.filter(FILTERS[filter].match) : sessions;

  const today = DateTime.now().setZone(tz).toISODate()!;
  const prev = DateTime.fromISO(dayISO, { zone: tz }).minus({ days: 1 }).toISODate()!;
  const next = DateTime.fromISO(dayISO, { zone: tz }).plus({ days: 1 }).toISODate()!;
  const heading = DateTime.fromISO(dayISO, { zone: tz }).toFormat("cccc, d LLLL yyyy");

  const base = `/admin?date=${dayISO}`;
  // Clicking the active card again clears the filter.
  const cardHref = (key: FilterKey) => (filter === key ? base : `${base}&filter=${key}`);
  const card = "h-full transition-colors hover:border-primary/40";
  const activeCard = "ring-2 ring-primary border-primary/40";

  return (
    <div>
      <PageHeader
        title="Daily schedule board"
        description={`Every lesson today in your timezone (${tz.replace(/_/g, " ")}).`}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin?date=${prev}`}>‹ Prev</Link>
            </Button>
            {dayISO !== today && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin">Today</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin?date=${next}`}>Next ›</Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{heading}</span>
        {dayISO === today && <Badge variant="default">Today</Badge>}
      </div>

      {/* Clickable stat cards — each filters the list below to those sessions. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={base}>
          <StatCard
            className={card}
            label="Lessons"
            value={sessions.length}
            hint={filter ? "Show all" : undefined}
            icon={<CalendarClock className="h-4 w-4" />}
          />
        </Link>
        <Link href={cardHref("live")}>
          <StatCard
            className={`${card} ${filter === "live" ? activeCard : ""}`}
            label="Live now"
            value={liveNow}
            tone={liveNow ? "success" : "default"}
            hint={liveNow ? "Click to see who" : undefined}
            icon={<Radio className="h-4 w-4" />}
          />
        </Link>
        <Link href={cardHref("unassigned")}>
          <StatCard
            className={`${card} ${filter === "unassigned" ? activeCard : ""}`}
            label="Unassigned"
            value={unassigned}
            tone={unassigned ? "warning" : "default"}
            hint={unassigned ? "Needs a teacher" : "All assigned"}
            icon={<UserRoundX className="h-4 w-4" />}
          />
        </Link>
        <Link href={cardHref("no_show")}>
          <StatCard
            className={`${card} ${filter === "no_show" ? activeCard : ""}`}
            label="No-shows"
            value={noShows}
            tone={noShows ? "warning" : "default"}
            hint={noShows ? "Click to see who" : undefined}
            icon={<CalendarX2 className="h-4 w-4" />}
          />
        </Link>
      </div>

      {filter && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Badge variant={filter === "live" ? "success" : "warning"}>{FILTERS[filter].label}</Badge>
          <span className="text-muted-foreground">
            {visible.length} {visible.length === 1 ? "lesson" : "lessons"}
          </span>
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link href={base}>
              <X className="h-3 w-3" /> Clear filter
            </Link>
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title={filter ? FILTERS[filter].empty : "No lessons scheduled"}
          description={
            filter
              ? "Clear the filter to see the full day."
              : "There are no sessions on this day. Schedule one from the Sessions console."
          }
          action={
            filter ? (
              <Button asChild variant="outline">
                <Link href={base}>Show all lessons</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/admin/sessions">Go to Sessions</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              viewerTz={tz}
              perspective="admin"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/sessions?focus=${s.id}`}>Manage</Link>
                </Button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
