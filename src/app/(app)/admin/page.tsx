import { CalendarClock, CheckCircle2, Radio, Users } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { LessonCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { lessonEndISO, lessonIsLive, roomIsOpen } from "@/lib/lessons/window";
import { dayWindowUTC } from "@/lib/time";
import { OFFICE_ROLES } from "@/lib/permissions";

/**
 * The office's board for today: every online lesson the viewer may observe,
 * from my_online_lessons(1) — an admin sees every enabled room, an in-charge
 * their own, support the lessons they may observe. Bookings, staffing,
 * follow-ups and approvals all live in the MathVision app; this page opens
 * rooms as an observer.
 */
export default async function AdminBoardPage() {
  const viewer = await requireRole(...OFFICE_ROLES);
  const tz = viewerTimeZone(viewer);

  const { startUTC, endUTC } = dayWindowUTC(tz);
  const nowISO = new Date().toISOString();
  const lessons = (await listMyOnlineLessons(viewer, 1)).filter(
    (l) => l.seat === "observer" && l.effective_start >= startUTC && l.effective_start < endUTC,
  );

  const live = lessons.filter((l) => lessonIsLive(l) && roomIsOpen(l));
  const done = lessons.filter((l) => lessonEndISO(l) < nowISO || l.status === "completed");
  const ahead = lessons.filter((l) => !live.includes(l) && !done.includes(l));

  return (
    <div>
      <PageHeader
        title="Board"
        description={`Today's online lessons you can observe, in your time zone (${tz.replace(/_/g, " ")}).`}
      />

      <div className="mb-4 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{DateTime.now().setZone(tz).toFormat("cccc, d LLLL yyyy")}</span>
        <Badge variant="default">Today</Badge>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="Lessons" value={lessons.length} icon={<CalendarClock className="h-4 w-4" />} />
        <StatCard label="Live now" value={live.length} tone={live.length ? "success" : "default"} icon={<Radio className="h-4 w-4" />} />
        <StatCard label="Done" value={done.length} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      {lessons.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No online lessons today"
          description="Online sessions are booked in the MathVision app; departments with the lesson platform turned on appear here."
        />
      ) : (
        <div className="space-y-6">
          <Section title="Live now" lessons={live} tz={tz} />
          <Section title="Coming up" lessons={ahead} tz={tz} />
          <Section title="Done" lessons={done} tz={tz} />
        </div>
      )}
    </div>
  );
}

function Section({ title, lessons, tz }: { title: string; lessons: Parameters<typeof LessonCard>[0]["lesson"][]; tz: string }) {
  if (lessons.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        {title} ({lessons.length})
      </h2>
      <div className="space-y-3">
        {lessons.map((l) => (
          <LessonCard key={l.session_id} lesson={l} viewerTz={tz} perspective="office" />
        ))}
      </div>
    </section>
  );
}
