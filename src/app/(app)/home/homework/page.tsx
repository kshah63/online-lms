import { ClipboardCheck } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { HomeworkList } from "@/components/homework/homework-list";
import { requireRole } from "@/lib/data/auth";
import { getHomeworkForProfile } from "@/lib/data/homework";

export default async function HomeworkPage() {
  const profile = await requireRole("student", "parent");
  const items = await getHomeworkForProfile(profile);

  const open = items.filter((h) => h.status !== "completed");
  const overdue = open.filter((h) => h.due_at != null && h.due_at < new Date().toISOString());
  const done = items.filter((h) => h.status === "completed");

  return (
    <div>
      <PageHeader
        title="Homework"
        description={profile.role === "parent" ? "Your children's assigned homework." : "Your assigned homework — tick items off as you finish."}
      />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="To do" value={open.length} tone={open.length ? "primary" : "default"} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "warning" : "default"} />
        <StatCard label="Completed" value={done.length} tone="success" />
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No homework yet" description="Homework set by your teacher appears here." />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">To do</h2>
              <HomeworkList items={open} viewerTz={profile.timezone} canMark showStudent={profile.role === "parent"} />
            </section>
          )}
          {done.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Completed</h2>
              <HomeworkList items={done} viewerTz={profile.timezone} canMark showStudent={profile.role === "parent"} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
