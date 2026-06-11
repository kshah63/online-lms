"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addAvailability } from "@/lib/actions/availability";
import type { ActionResult } from "@/lib/actions/types";
import { WEEKDAYS } from "@/lib/constants";

const initial: ActionResult = { ok: false, message: "" };

export function AvailabilityForm() {
  const [state, formAction] = useFormState(
    async (_: ActionResult, fd: FormData) => addAvailability(fd),
    initial,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label>Day</Label>
        <Select name="weekday" defaultValue="1">
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEKDAYS.map((d, i) => (
              <SelectItem key={i} value={String(i)}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="start_time">From</Label>
        <Input id="start_time" name="start_time" type="time" defaultValue="09:00" className="w-32" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="end_time">To</Label>
        <Input id="end_time" name="end_time" type="time" defaultValue="17:00" className="w-32" />
      </div>
      <AddButton />
      {state.message && (
        <p className={`w-full text-sm ${state.ok ? "text-success" : "text-destructive"}`}>{state.message}</p>
      )}
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      Add
    </Button>
  );
}
