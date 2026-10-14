import Link from "next/link";
import { BarChart3, Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { StudentMatch } from "@/lib/data/progress";

/**
 * Search-then-pick over the students the viewer may read: the typing
 * filters a real list, and the pick is a real profile by id — the door to
 * /home/progress/<id>. A plain GET form, so the search is a link that can
 * be shared and comes back on reload.
 */
export function StudentSearch({ q, students, total, limit }: { q: string; students: StudentMatch[]; total: number; limit: number }) {
  return (
    <div className="space-y-4">
      <form method="get" action="/home/progress" className="flex max-w-lg items-center gap-2">
        <label htmlFor="student-search" className="sr-only">
          Search students by name
        </label>
        <Input id="student-search" name="q" defaultValue={q} placeholder="Part of the child's name" autoComplete="off" autoFocus={!q} />
        <Button type="submit" variant="outline">
          <Search className="h-4 w-4" /> Search
        </Button>
      </form>

      {!q ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Find a child by name" description="Type part of their name and pick them from the list. Their progress opens on the next screen." />
      ) : students.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title={`No student matches “${q}”`} description="Try fewer letters, or the name the family uses." />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {total > students.length ? `Showing the first ${students.length} of ${total} — add more letters to narrow it.` : `${total} ${total === 1 ? "student" : "students"}`}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {students.map((s) => (
              <Link key={s.id} href={`/home/progress/${s.id}`} className="block">
                <Card className="transition-colors hover:bg-secondary/60">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Avatar name={s.name} size={32} />
                    <div className="min-w-0">
                      <div className="font-medium">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.grade_level ?? "Student"}</div>
                    </div>
                    <BarChart3 className="ml-auto h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {total > limit && <p className="text-xs text-muted-foreground">The list stops at {limit}.</p>}
        </div>
      )}
    </div>
  );
}
