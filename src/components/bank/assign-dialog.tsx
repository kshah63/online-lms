"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { DateTime } from "luxon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChipRow } from "@/components/bank/chip-row";
import { Notice } from "@/components/bank/notice";
import { assignPracticeAction } from "@/lib/actions/bank";
import { SET_KIND_LABEL, type CourseStudent, type PracticeSetRow } from "@/lib/bank/types";
import { cn } from "@/lib/utils";

type DueChoice = "none" | "tomorrow" | "3d" | "week" | "custom";

const DUE_OPTIONS: { value: DueChoice; label: string }[] = [
  { value: "none", label: "No due date" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3d", label: "In 3 days" },
  { value: "week", label: "In a week" },
  { value: "custom", label: "Pick a date…" },
];

/** Assign a live set to students on the course, at home, with a due date. The database pushes it to the family. */
export function AssignDialog({
  open,
  onOpenChange,
  courseId,
  sets,
  students,
  initialSetId,
  tz,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  sets: PracticeSetRow[];
  students: CourseStudent[];
  initialSetId: string | null;
  tz: string;
  onAssigned: (message: string) => void;
}) {
  const live = useMemo(() => sets.filter((s) => s.status === "live"), [sets]);
  const [setId, setSetId] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [due, setDue] = useState<DueChoice>("week");
  const [custom, setCustom] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setSetId(initialSetId && live.some((s) => s.id === initialSetId) ? initialSetId : (live[0]?.id ?? ""));
    setPicked(new Set(students.length === 1 ? [students[0]!.id] : []));
    setDue("week");
    setCustom(DateTime.now().setZone(tz).plus({ days: 7 }).set({ hour: 18, minute: 0 }).toFormat("yyyy-LL-dd'T'HH:mm"));
    setNotice(null);
  }, [open, initialSetId, live, students, tz]);

  const dueAt = useMemo((): string | null => {
    const evening = (days: number) => DateTime.now().setZone(tz).plus({ days }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO();
    switch (due) {
      case "none":
        return null;
      case "tomorrow":
        return evening(1);
      case "3d":
        return evening(3);
      case "week":
        return evening(7);
      case "custom": {
        const dt = DateTime.fromISO(custom, { zone: tz });
        return dt.isValid ? dt.toUTC().toISO() : null;
      }
    }
  }, [due, custom, tz]);

  const set = live.find((s) => s.id === setId) ?? null;

  function assign() {
    if (!set) return;
    setNotice(null);
    start(async () => {
      const r = await assignPracticeAction({ courseId, setId: set.id, studentIds: [...picked], dueAt });
      setNotice({ ok: r.ok, message: r.message });
      if (r.ok) {
        onAssigned(r.message);
        onOpenChange(false);
      }
    });
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" /> Assign at home
          </DialogTitle>
          <DialogDescription>The student and the family are told in the MathVision app; a test opens in the browser with its timer.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Set</Label>
            {live.length === 0 ? (
              <p className="text-sm text-muted-foreground">No live sets on this course yet — make one from approved questions first.</p>
            ) : (
              <Select value={setId} onValueChange={setSetId}>
                <SelectTrigger aria-label="Set to assign">
                  <SelectValue placeholder="Pick a set" />
                </SelectTrigger>
                <SelectContent>
                  {live.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title} · {SET_KIND_LABEL[s.kind === "test" ? "test" : "practice"]}, {s.question_count} question{s.question_count === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {set && (
              <div className="flex flex-wrap gap-1.5">
                {set.time_limit_minutes != null && <Badge variant="secondary">{set.time_limit_minutes} min</Badge>}
                {set.integrity_settings.camera_required && <Badge variant="secondary">camera</Badge>}
                {set.integrity_settings.hide_solutions && <Badge variant="secondary">solutions hidden</Badge>}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Students on the course</Label>
              {students.length > 1 && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPicked(picked.size === students.length ? new Set() : new Set(students.map((s) => s.id)))}>
                  {picked.size === students.length ? "Clear" : "Everyone"}
                </button>
              )}
            </div>
            {students.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is enrolled on this course in the app yet.</p>
            ) : (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                {students.map((s) => {
                  const on = picked.has(s.id);
                  return (
                    <li key={s.id}>
                      <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary", on && "bg-primary/5")}>
                        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>{on && <Check className="h-3.5 w-3.5" />}</span>
                        <Avatar name={s.name} size={24} />
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        {s.grade_level && <span className="text-xs text-muted-foreground">{s.grade_level}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Due</Label>
            <ChipRow options={DUE_OPTIONS} value={due} onChange={setDue} />
            {due === "custom" && (
              <input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Due date and time"
                className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            {dueAt && <p className="text-xs text-muted-foreground">Due {DateTime.fromISO(dueAt, { zone: "utc" }).setZone(tz).toFormat("ccc d LLL, h:mm a")} ({tz.replace(/_/g, " ")}).</p>}
          </div>
        </div>

        {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!set || picked.size === 0 || pending || (due === "custom" && !dueAt)} onClick={assign}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Assign to {picked.size || "…"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
