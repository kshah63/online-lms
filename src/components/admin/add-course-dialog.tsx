"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCourse } from "@/lib/actions/courses";
import type { ActionResult } from "@/lib/actions/types";

const initial: ActionResult = { ok: false, message: "" };

export function AddCourseDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (_: ActionResult, fd: FormData) => {
    const res = await createCourse(fd);
    if (res.ok) setTimeout(() => setOpen(false), 700);
    return res;
  }, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <BookPlus className="h-4 w-4" /> Add course
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a course</DialogTitle>
          <DialogDescription>Create a course students can be enrolled in and book lessons for.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Course name</Label>
            <Input id="name" name="name" placeholder="e.g. IGCSE Mathematics" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject (optional)</Label>
            <Input id="subject" name="subject" placeholder="e.g. Mathematics" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="materials_course_id">Materials Portal course ID (optional)</Label>
            <Input id="materials_course_id" name="materials_course_id" placeholder="UUID from the Materials Portal" />
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
      Create course
    </Button>
  );
}
