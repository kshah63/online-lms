"use client";

import { useState, useTransition } from "react";
import { Archive, ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, RotateCcw, Sprout, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/bank/notice";
import { seedSyllabusAction, upsertSyllabusTopicsAction } from "@/lib/actions/syllabus";
import { applyUpsert, moveTopic, nextSortOrder, orderTopics, toInput } from "@/lib/bank/syllabus-order";
import type { SyllabusTopic, SyllabusTopicInput } from "@/lib/bank/types";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The course's syllabus: the ordered topics a student's progress is read
 * against. Seeded once from the booking form's course_topics, then renamed,
 * added to, reordered and deactivated here, each change one
 * upsert_syllabus_topic (a move is two, with the sort_orders swapped).
 */
export function SyllabusEditor({ course, topics: initial, courseTopicCount }: { course: Course; topics: SyllabusTopic[]; courseTopicCount: number }) {
  const [topics, setTopics] = useState(() => orderTopics(initial));
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [adding, setAdding] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const active = topics.filter((t) => t.is_active);
  const inactive = topics.filter((t) => !t.is_active);
  const seeded = topics.filter((t) => t.course_topic_id).length;

  function save(inputs: SyllabusTopicInput[], key: string, after?: () => void) {
    setBusy(key);
    setNotice(null);
    start(async () => {
      const r = await upsertSyllabusTopicsAction(course.id, inputs);
      setBusy(null);
      setNotice({ ok: r.ok, message: r.message });
      if (!r.ok) return;
      setTopics((prev) => orderTopics(inputs.reduce((acc, input, i) => applyUpsert(acc, course.id, input, r.ids[i] ?? crypto.randomUUID()), prev)));
      after?.();
    });
  }

  function seed() {
    setBusy("seed");
    setNotice(null);
    start(async () => {
      const r = await seedSyllabusAction(course.id);
      setBusy(null);
      setNotice({ ok: r.ok, message: r.message });
      if (r.ok && r.rows) setTopics((prev) => orderTopics([...prev, ...r.rows!]));
    });
  }

  const rename = (t: SyllabusTopic, label: string) => save([{ ...toInput(t), label }], t.id, () => setEditing(null));
  const move = (t: SyllabusTopic, direction: "up" | "down") => {
    const swaps = moveTopic(topics, t.id, direction);
    if (swaps.length) save(swaps, t.id);
  };
  const setActive = (t: SyllabusTopic, is_active: boolean) => save([{ ...toInput(t), is_active }], t.id);
  const add = () => {
    const label = adding.trim();
    if (!label) return;
    save([{ id: null, label, parent_id: null, sort_order: nextSortOrder(topics), is_active: true }], "add", () => setAdding(""));
  };

  const seedButton = (
    <Button type="button" variant="outline" size="sm" disabled={pending || courseTopicCount === 0} onClick={seed}>
      {busy === "seed" ? <Loader2 className="animate-spin" /> : <Sprout />} Seed from course topics ({courseTopicCount})
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          {active.length} active topic{active.length === 1 ? "" : "s"}
          {inactive.length > 0 && `, ${inactive.length} deactivated`}
          {seeded > 0 && ` · ${seeded} from the course's topic list`}
        </span>
        <div className="ml-auto">{seedButton}</div>
      </div>

      {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}

      {topics.length === 0 ? (
        <EmptyState
          icon={<Sprout className="h-5 w-5" />}
          title="No syllabus yet"
          description={
            courseTopicCount > 0
              ? `Start from the ${courseTopicCount} topic${courseTopicCount === 1 ? "" : "s"} the booking form already lists for ${course.name}, then shape it here.`
              : `${course.name} has no topics on the booking form either; add the first one below.`
          }
          action={courseTopicCount > 0 ? seedButton : undefined}
        />
      ) : (
        <ol className="space-y-1.5">
          {active.map((t, i) => (
            <li key={t.id} className={cn("flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm", busy === t.id && "opacity-60")}>
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
              {editing?.id === t.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(t, editing.label);
                  }}
                >
                  <Input autoFocus value={editing.label} onChange={(e) => setEditing({ id: t.id, label: e.target.value })} aria-label="Topic label" className="h-8" />
                  <Button type="submit" size="sm" disabled={pending || !editing.label.trim()}>
                    <Check /> Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    <X />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.label}</span>
                  {t.course_topic_id && (
                    <Badge variant="secondary" className="hidden sm:inline-flex">
                      booking form
                    </Badge>
                  )}
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Rename ${t.label}`} disabled={pending} onClick={() => setEditing({ id: t.id, label: t.label })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${t.label} up`} disabled={pending || i === 0} onClick={() => move(t, "up")}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${t.label} down`} disabled={pending || i === active.length - 1} onClick={() => move(t, "down")}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Deactivate ${t.label}`} disabled={pending} onClick={() => setActive(t, false)}>
                    <Archive className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a topic…" aria-label="New topic label" />
        <Button type="submit" variant="outline" disabled={pending || !adding.trim()}>
          {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>

      {inactive.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Deactivated ({inactive.length})</h2>
          <ul className="space-y-1.5">
            {inactive.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                <span className="min-w-0 flex-1 truncate line-through">{t.label}</span>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setActive(t, true)}>
                  <RotateCcw /> Reactivate
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">A deactivated topic keeps its marks and questions; it leaves the pick lists and the progress page.</p>
        </section>
      )}
    </div>
  );
}
