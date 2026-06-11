import Link from "next/link";
import { CalendarClock, CalendarX2, Radio, UserRoundX, Users } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/data/auth";
import { getSessionsForDay } from "@/lib/data/sessions";

export default async function AdminBoardPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const admin = await requireRole("admin");
  const tz = admin.timezone;

  const dayISO = searchParams.date ?? DateTime.now().setZone(tz).toISODate()!;
  const sessions = await getSessionsForDay(tz, dayISO);

  const liveNow = sessions.filter((s) => s.status === "in_progress").length;
  const unassigned = sessions.filter((s) => !s.teacher_id).length;
  const noShows = sessions.filter((s) => s.status === "no_show").length;

  const today = DateTime.now().setZone(tz).toISODate()!;
  const prev = DateTime.fromISO(dayISO, { zone: tz }).minus({ days: 1 }).toISODate()!;
  const next = DateTime.fromISO(dayISO, { zone: tz }).plus({ days: 1 }).toISODate()!;
  const heading = DateTime.fromISO(dayISO, { zone: tz }).toFormat("cccc, d LLLL yyyy");

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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Lessons" value={sessions.length} icon={<CalendarClock className="h-4 w-4" />} />
        <StatCard label="Live now" value={liveNow} tone={liveNow ? "success" : "default"} icon={<Radio className="h-4 w-4" />} />
        <StatCard
          label="Unassigned"
          value={unassigned}
          tone={unassigned ? "warning" : "default"}
          hint={unassigned ? "Needs a teacher" : "All assigned"}
          icon={<UserRoundX className="h-4 w-4" />}
        />
        <StatCard label="No-shows" value={noShows} tone={noShows ? "warning" : "default"} icon={<CalendarX2 className="h-4 w-4" />} />
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No lessons scheduled"
          description="There are no sessions on this day. Schedule one from the Sessions console."
          action={
            <Button asChild>
              <Link href="/admin/sessions">Go to Sessions</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
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
