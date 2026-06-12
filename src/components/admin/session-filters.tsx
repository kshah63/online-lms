"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FilterOption {
  id: string;
  label: string;
}

/**
 * Combinable session filters (student / course / status / day), kept in the
 * URL so views are linkable and the back button works.
 */
export function SessionFilters({
  students,
  courses,
  statuses,
}: {
  students: FilterOption[];
  courses: FilterOption[];
  statuses: FilterOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function patch(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/admin/sessions?${next.toString()}`, { scroll: false });
  }

  const filtered = ["student", "course", "status", "date"].some((k) => params.get(k));
  const select =
    "h-9 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by student"
        className={select}
        value={params.get("student") ?? ""}
        onChange={(e) => patch("student", e.target.value)}
      >
        <option value="">All students</option>
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by course"
        className={select}
        value={params.get("course") ?? ""}
        onChange={(e) => patch("course", e.target.value)}
      >
        <option value="">All courses</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        className={select}
        value={params.get("status") ?? ""}
        onChange={(e) => patch("status", e.target.value)}
      >
        <option value="">Any status</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <input
        type="date"
        aria-label="Filter by day"
        className={select}
        value={params.get("date") ?? ""}
        onChange={(e) => patch("date", e.target.value)}
      />

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => {
            const view = params.get("view");
            router.replace(view ? `/admin/sessions?view=${view}` : "/admin/sessions", { scroll: false });
          }}
        >
          <X className="h-3 w-3" /> Clear filters
        </Button>
      )}
    </div>
  );
}
