"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/actions/auth";

type State = { error: string } | null;

export function SignInForm() {
  const [state, formAction] = useFormState<State, FormData>(
    async (_, fd) => (await signIn(fd)) ?? null,
    null,
  );

  return (
    <div>
      <h2 className="text-xl font-semibold">Sign in</h2>
      <p className="mb-6 text-sm text-muted-foreground">Welcome back. Enter your details to continue.</p>

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="you@example.com" required />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" placeholder="••••••••" required />
        </div>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
        <SubmitButton />
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        No account yet?{" "}
        <Link href="/request-access" className="text-primary hover:underline">
          Request access
        </Link>
      </p>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Sign in
    </Button>
  );
}
