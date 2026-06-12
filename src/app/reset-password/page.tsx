"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { updatePassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/brand";

type State = { ok: boolean; message: string } | null;

/** Arrived at from the emailed recovery link (via /auth/callback), so the
 * visitor already holds a recovery session and may set a new password. */
export default function ResetPasswordPage() {
  const [state, formAction] = useFormState<State, FormData>(
    async (_, fd) => updatePassword(fd),
    null,
  );

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <BrandWordmark size={32} textClassName="text-lg" />
        </div>

        {state?.ok ? (
          <div className="rounded-xl border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-3 text-lg font-semibold">Password updated</h1>
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
            <Button asChild className="mt-5">
              <Link href="/">Continue to the app</Link>
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Choose a new password</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              At least 8 characters. You&rsquo;ll use this from now on.
            </p>
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" name="password" type="password" minLength={8} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" name="confirm" type="password" minLength={8} required />
              </div>
              {state && !state.ok && <p className="text-sm text-destructive">{state.message}</p>}
              <SubmitButton />
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Set new password
    </Button>
  );
}
