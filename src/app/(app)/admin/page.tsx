import Link from "next/link";
import { CalendarClock, Radio, Users, X } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { LessonCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { lessonIsLive, roomIsOpen } from "@/lib/lessons/window";
import { dayWindowUTC } from "@/lib/time";
import { OFFICE_ROLES } from "@/lib/permissions";
import type { OnlineLesson } from "@/lib/types";

const FILTERS = {
  live: {
    label: "Live now",
    match: (l: OnlineLesson) => lessonIsLive(l) && roomIsOpen(l),
    empty: "No online lessons are live right now.",
  },
  unstaffed: {
    label: "No teacher added",
    match: (l: OnlineLesson) => !l.teacher_id,
    empty: "Every online lesson on this day has a teacher added.",
  },
} as const;

type FilterKey = keyof typeof FILTERS;

/**
 * The office's view of the online lessons: an admin sees every room, an
 * in-charge their own room, support the lessons they may observe — whatever
 * my_online_lessons returns as observer rows. Bookings, staffing, follow-ups
 * and approvals all live in the MathVision app; this page only opens rooms.
 */
export default async function AdminBoardPage({
  searchParams,
}: {
  searchParams: { date?: string; filter?: string };
}) {
  const viewer = await requireRole(...OFFICE_ROLES);
  const tz = viewerTimeZone(viewer);

  const dayISO = searchParams.date ?? DateTime.now().setZone(tz).toISODate()!;
  const { startUTC, endUTC } = dayWindowUTC(tz, dayISO);
  const lessons = (await listMyOnlineLessons(viewer, 14)).filter(
    (l) => l.seat === "observer" && l.effective_start >= startUTC && l.effective_start < endUTC,
  );

  const filter = (searchParams.filter && searchParams.filter in FILTERS ? searchParams.filter : undefined) as
    | FilterKey
    | undefined;

  const liveNow = lessons.filter(FILTERS.live.match).length;
  const unstaffed = lessons.filter(FILTERS.unstaffed.match).length;
  const visible = filter ? lessons.filter(FILTERS[filter].match) : lessons;

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
        title="Online lessons"
        description={`Every online lesson you can observe, in your time zone (${tz.replace(/_/g, " ")}).`}
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

      {/* Clickable stat cards — each filters the list below to those lessons. */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Link href={base}>
          <StatCard
            className={card}
            label="Lessons"
            value={lessons.length}
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
        <Link href={cardHref("unstaffed")}>
          <StatCard
            className={`${card} ${filter === "unstaffed" ? activeCard : ""}`}
            label="No teacher added"
            value={unstaffed}
            hint="Staffing is decided in the app"
            icon={<Users className="h-4 w-4" />}
          />
        </Link>
      </div>

      {filter && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Badge variant={filter === "live" ? "success" : "secondary"}>{FILTERS[filter].label}</Badge>
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
          title={filter ? FILTERS[filter].empty : "No online lessons on this day"}
          description={
            filter
              ? "Clear the filter to see the full day."
              : "Online sessions are booked in the MathVision app; departments with the lesson platform turned on appear here."
          }
          action={
            filter ? (
              <Button asChild variant="outline">
                <Link href={base}>Show all lessons</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((l) => (
            <LessonCard key={l.session_id} lesson={l} viewerTz={tz} perspective="office" />
          ))}
        </div>
      )}
    </div>
  );
}
