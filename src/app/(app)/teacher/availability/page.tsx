import { Clock, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AvailabilityForm } from "@/components/teacher/availability-form";
import { requireRole } from "@/lib/data/auth";
import { getAvailability } from "@/lib/data/availability";
import { WEEKDAYS } from "@/lib/constants";
import { removeAvailability } from "@/lib/actions/availability";

export default async function AvailabilityPage() {
  const teacher = await requireRole("teacher");
  const slots = await getAvailability(teacher.id);

  const byDay = WEEKDAYS.map((label, weekday) => ({
    label,
    weekday,
    slots: slots.filter((s) => s.weekday === weekday),
  }));

  return (
    <div>
      <PageHeader
        title="Availability"
        description={`Hours are in your timezone (${teacher.timezone.replace(/_/g, " ")}); admin sees them converted when assigning.`}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a weekly slot</CardTitle>
          <CardDescription>Set the recurring windows you&rsquo;re available to teach.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityForm />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {byDay.map((day) => (
          <Card key={day.weekday} className={day.slots.length === 0 ? "opacity-60" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {day.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {day.slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">Unavailable</p>
              ) : (
                <ul className="space-y-2">
                  {day.slots.map((s) => (
                    <li key={s.id} className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-1.5 text-sm">
                      <span className="font-medium tabular-nums">
                        {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                      </span>
                      <form action={removeAvailability}>
                        <input type="hidden" name="id" value={s.id} />
                        <Button type="submit" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
