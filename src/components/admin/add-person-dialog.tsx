"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Check, Loader2, UserPlus } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createUserAccount, type ProvisionResult } from "@/lib/actions/accounts";
import { TempPassword } from "@/components/admin/temp-password";
import { COMMON_TIMEZONES, guessBrowserTz } from "@/lib/time";

const initial: ProvisionResult = { ok: false, message: "" };

export function AddPersonDialog({ parents }: { parents: { id: string; display_name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("student");
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(guessBrowserTz()), []);

  const [state, formAction] = useFormState(async (_: ProvisionResult, fd: FormData) => createUserAccount(fd), initial);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" /> Add person
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>Creates a real login. You&rsquo;ll get a temporary password to share with them.</DialogDescription>
        </DialogHeader>

        {state.ok && state.tempPassword ? (
          <TempPassword email={state.email ?? ""} password={state.tempPassword} onDone={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select name="role" value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="parent">Parent / guardian</SelectItem>
                    <SelectItem value="teacher">Teacher</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <input type="hidden" name="timezone" value={tz} />
                <Select value={tz} onValueChange={setTz}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((z) => (
                      <SelectItem key={z} value={z}>
                        {z.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="display_name">Full name</Label>
                <Input id="display_name" name="display_name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input id="phone" name="phone" placeholder="+1 555 000 1234" />
              </div>
              {role === "student" && (
                <div className="space-y-1.5">
                  <Label>Link to parent (optional)</Label>
                  <Select name="parent_id">
                    <SelectTrigger>
                      <SelectValue placeholder="No parent" />
                    </SelectTrigger>
                    <SelectContent>
                      {parents.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {state.message && !state.ok && <p className="text-sm text-destructive">{state.message}</p>}
            <DialogFooter>
              <CreateButton />
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      Create account
    </Button>
  );
}
