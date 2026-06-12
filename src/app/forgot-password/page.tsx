"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { requestPasswordReset } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/brand";

type State = { ok: boolean; message: string } | null;

export default function ForgotPasswordPage() {
  const [state, formAction] = useFormState<State, FormData>(
    async (_, fd) => requestPasswordReset(fd),
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
            <MailCheck className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-3 text-lg font-semibold">Check your email</h1>
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
            <Button asChild variant="outline" className="mt-5">
              <Link href="/login">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Reset your password</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Enter the email on your account and we&rsquo;ll send a reset link.
            </p>
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="you@example.com" required />
              </div>
              {state && !state.ok && <p className="text-sm text-destructive">{state.message}</p>}
              <SubmitButton />
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Remembered it?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
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
      Send reset link
    </Button>
  );
}
