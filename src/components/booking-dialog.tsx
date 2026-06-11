"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { CalendarPlus, Check, Loader2, PencilLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bookLesson, rescheduleSession } from "@/lib/actions/bookings";
import type { ActionResult } from "@/lib/actions/types";
import { guessBrowserTz } from "@/lib/time";

export interface BookOption {
  studentId: string;
  studentName: string;
  courses: { id: string; name: string }[];
}

const initial: ActionResult = { ok: false, message: "" };
const DURATIONS = ["30", "45", "60", "90"];

export function BookingDialog({
  mode,
  options,
  defaultTz,
  edit,
}: {
  mode: "create" | "edit";
  options?: BookOption[];
  defaultTz: string;
  // edit mode context
  edit?: { sessionId: string; studentName: string; courseName: string; date: string; time: string; duration: number };
}) {
  const [open, setOpen] = useState(false);
  const tz = defaultTz || guessBrowserTz();

  const action = mode === "create" ? bookLesson : rescheduleSession;
  const [state, formAction] = useFormState(async (_: ActionResult, fd: FormData) => {
    const res = await action(fd);
    if (res.ok) setTimeout(() => setOpen(false), 700);
    return res;
  }, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <CalendarPlus className="h-4 w-4" /> Book a lesson
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <PencilLine className="h-4 w-4" /> Reschedule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Book a lesson" : "Reschedule lesson"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Pick a course and time. An admin will assign a teacher."
              : `${edit?.courseName} for ${edit?.studentName}. Times are in your timezone.`}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="timezone" value={tz} />
          {mode === "create" ? (
            <CreateFields options={options ?? []} />
          ) : (
            <input type="hidden" name="session_id" value={edit?.sessionId} />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required defaultValue={edit?.date} min={today()} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Start time</Label>
              <Input id="time" name="time" type="time" required defaultValue={edit?.time ?? "16:00"} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Duration</Label>
            <Select name="duration" defaultValue={String(edit?.duration ?? 60)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "create" && (
            <div className="space-y-1.5">
              <Label htmlFor="agenda">What would you like to cover? (optional)</Label>
              <Textarea id="agenda" name="agenda" rows={2} />
            </div>
          )}

          {state.message && (
            <p className={`text-sm ${state.ok ? "text-success" : "text-destructive"}`}>{state.message}</p>
          )}

          <DialogFooter>
            <SubmitButton label={mode === "create" ? "Request lesson" : "Save new time"} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateFields({ options }: { options: BookOption[] }) {
  const [studentId, setStudentId] = useState(options[0]?.studentId ?? "");
  const courses = useMemo(
    () => options.find((o) => o.studentId === studentId)?.courses ?? [],
    [options, studentId],
  );
  const multiStudent = options.length > 1;

  return (
    <>
      {multiStudent ? (
        <div className="space-y-1.5">
          <Label>Student</Label>
          <Select name="student_id" value={studentId} onValueChange={setStudentId} required>
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.studentId} value={o.studentId}>
                  {o.studentName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <input type="hidden" name="student_id" value={studentId} />
      )}

      <div className="space-y-1.5">
        <Label>Course</Label>
        <Select name="course_id" required>
          <SelectTrigger>
            <SelectValue placeholder={courses.length ? "Select a course" : "No enrolled courses"} />
          </SelectTrigger>
          <SelectContent>
            {courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      {label}
    </Button>
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
