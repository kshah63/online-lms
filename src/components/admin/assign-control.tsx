"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignTeacher } from "@/lib/actions/sessions";
import type { Profile } from "@/lib/types";

export function AssignControl({
  sessionId,
  teachers,
  currentTeacherId,
}: {
  sessionId: string;
  teachers: Profile[];
  currentTeacherId: string | null;
}) {
  const [value, setValue] = useState<string>(currentTeacherId ?? "");

  return (
    <form action={assignTeacher} className="flex items-center gap-2">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="teacher_id" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Pick teacher" />
        </SelectTrigger>
        <SelectContent>
          {teachers.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AssignButton disabled={!value || value === currentTeacherId} reassign={!!currentTeacherId} />
    </form>
  );
}

function AssignButton({ disabled, reassign }: { disabled: boolean; reassign: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={reassign ? "outline" : "default"} disabled={disabled || pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}
      {reassign ? "Reassign" : "Assign"}
    </Button>
  );
}
