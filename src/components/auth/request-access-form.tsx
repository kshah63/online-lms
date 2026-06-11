"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { submitAccountRequest } from "@/lib/actions/accounts";
import { COMMON_TIMEZONES, guessBrowserTz } from "@/lib/time";

const initial = { ok: false, message: "" };

export function RequestAccessForm() {
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(guessBrowserTz()), []);

  const [state, formAction] = useFormState(
    async (_: { ok: boolean; message: string }, fd: FormData) => submitAccountRequest(fd),
    initial,
  );

  if (state.ok) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
        <h2 className="text-lg font-semibold">Request received</h2>
        <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold">Request an account</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Tell us a bit about yourself and an administrator will set you up.
      </p>
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label>This account is for a…</Label>
          <Select name="role" defaultValue="student">
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
        <div className="space-y-1.5">
          <Label htmlFor="message">Anything we should know? (optional)</Label>
          <Textarea id="message" name="message" rows={3} placeholder="e.g. which subject, child's name, preferred times" />
        </div>
        {state.message && !state.ok && <p className="text-sm text-destructive">{state.message}</p>}
        <SubmitButton />
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      Submit request
    </Button>
  );
}
