"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { enrollStudent } from "@/lib/actions/courses";
import type { ActionResult } from "@/lib/actions/types";

const initial: ActionResult = { ok: false, message: "" };

export function EnrollControl({
  courseId,
  available,
}: {
  courseId: string;
  available: { id: string; display_name: string }[];
}) {
  const [value, setValue] = useState("");
  const [state, formAction] = useFormState(async (_: ActionResult, fd: FormData) => {
    const res = await enrollStudent(fd);
    if (res.ok) setValue("");
    return res;
  }, initial);

  if (available.length === 0) {
    return <p className="text-xs text-muted-foreground">All students are enrolled.</p>;
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="student_id" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-8 w-48 text-xs">
          <SelectValue placeholder="Enroll a student…" />
        </SelectTrigger>
        <SelectContent>
          {available.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <EnrollButton disabled={!value} />
      {state.message && !state.ok && <span className="text-xs text-destructive">{state.message}</span>}
    </form>
  );
}

function EnrollButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={disabled || pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
      Enroll
    </Button>
  );
}
