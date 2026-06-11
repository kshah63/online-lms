"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { BookPlus, Check, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestEnrollment } from "@/lib/actions/enrollment";
import type { ActionResult } from "@/lib/actions/types";

export interface RequestOption {
  studentId: string;
  studentName: string;
  courses: { id: string; name: string }[];
}

const initial: ActionResult = { ok: false, message: "" };

export function RequestCourseDialog({ options }: { options: RequestOption[] }) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(options[0]?.studentId ?? "");
  const [state, formAction] = useFormState(async (_: ActionResult, fd: FormData) => {
    const res = await requestEnrollment(fd);
    if (res.ok) setTimeout(() => setOpen(false), 900);
    return res;
  }, initial);

  const courses = useMemo(
    () => options.find((o) => o.studentId === studentId)?.courses ?? [],
    [options, studentId],
  );
  const multiStudent = options.length > 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BookPlus className="h-4 w-4" /> Request a course
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a course</DialogTitle>
          <DialogDescription>Ask to be enrolled in a new course. An admin will review your request.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
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
                <SelectValue placeholder={courses.length ? "Select a course" : "No more courses to request"} />
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

          {state.message && (
            <p className={`text-sm ${state.ok ? "text-success" : "text-destructive"}`}>{state.message}</p>
          )}
          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      Send request
    </Button>
  );
}
