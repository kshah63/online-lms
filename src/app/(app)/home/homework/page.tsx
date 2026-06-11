import { ClipboardCheck } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { HomeworkList } from "@/components/homework/homework-list";
import { requireRole } from "@/lib/data/auth";
import { getHomeworkForProfile } from "@/lib/data/homework";

export default async function HomeworkPage() {
  const profile = await requireRole("student", "parent");
  const items = await getHomeworkForProfile(profile);

  const nowISO = new Date().toISOString();
  const toDo = items.filter((h) => h.status === "assigned" || h.status === "incomplete");
  const submitted = items.filter((h) => h.status === "submitted");
  const done = items.filter((h) => h.status === "completed");
  const overdue = toDo.filter((h) => h.due_at != null && h.due_at < nowISO);

  return (
    <div>
      <PageHeader
        title="Homework"
        description={
          profile.role === "parent"
            ? "Your children's homework — open the notebook to see their work."
            : "Open each item in your notebook, do the work, then submit it for your teacher to check."
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatCard label="To do" value={toDo.length} tone={toDo.length ? "primary" : "default"} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "warning" : "default"} />
        <StatCard label="Submitted" value={submitted.length} />
        <StatCard label="Verified" value={done.length} tone="success" />
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No homework yet" description="Homework set by your teacher appears here." />
      ) : (
        <div className="space-y-6">
          {toDo.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">To do</h2>
              <HomeworkList items={toDo} viewerTz={profile.timezone} showStudent={profile.role === "parent"} />
            </section>
          )}
          {submitted.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Submitted — awaiting review</h2>
              <HomeworkList items={submitted} viewerTz={profile.timezone} showStudent={profile.role === "parent"} />
            </section>
          )}
          {done.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Verified</h2>
              <HomeworkList items={done} viewerTz={profile.timezone} showStudent={profile.role === "parent"} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
