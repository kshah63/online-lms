"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  requestFamilyCode,
  signInTeam,
  verifyFamilyCode,
  type FamilyCodeState,
  type TeamSignInState,
} from "@/lib/actions/auth";

/**
 * The two doors the app has, side by side: families sign in with a six-digit
 * email code, the team with email and password (then their authenticator).
 */
export function SignInDoors() {
  return (
    <div>
      <h2 className="text-xl font-semibold">Sign in</h2>
      <p className="mb-5 text-sm text-muted-foreground">Use the details MathVision already has for you.</p>

      <Tabs defaultValue="family">
        <TabsList className="mb-5 grid w-full grid-cols-2">
          <TabsTrigger value="family">Families and students</TabsTrigger>
          <TabsTrigger value="team">MathVision team</TabsTrigger>
        </TabsList>
        <TabsContent value="family">
          <FamilyDoor />
        </TabsContent>
        <TabsContent value="team">
          <TeamDoor />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Family: one box, one button, no password. A code proves the inbox.
// ---------------------------------------------------------------------------

function FamilyDoor() {
  const [state, requestAction] = useFormState<FamilyCodeState, FormData>(requestFamilyCode, { stage: "ask" });
  const [verifyState, verifyAction] = useFormState<FamilyCodeState, FormData>(verifyFamilyCode, { stage: "ask" });

  // The verify step owns the state once a code has been sent; "use a
  // different email" is a fresh request form.
  const current: FamilyCodeState = verifyState.stage === "code" ? verifyState : state;

  if (current.stage === "code") {
    return (
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="email" value={current.email} />
        <p className="text-sm">
          We emailed a six-digit code to <span className="font-medium">{current.email}</span>. It usually arrives
          within a minute — check junk if it does not.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="code">Six-digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            className="text-center text-lg tracking-[0.4em]"
            autoFocus
            required
          />
        </div>
        {current.error && <p className="text-sm text-destructive">{current.error}</p>}
        <Submit label="Sign in" />
        <p className="text-center text-xs text-muted-foreground">
          Wrong address?{" "}
          <a href="/login" className="text-primary hover:underline">
            Use a different email
          </a>
        </p>
      </form>
    );
  }

  return (
    <form action={requestAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="identifier">Email or portal username</Label>
        <Input id="identifier" name="identifier" autoComplete="username" placeholder="you@example.com" required />
      </div>
      {current.error && <p className="text-sm text-destructive">{current.error}</p>}
      <Submit label="Email me a code" icon={<Mail className="h-4 w-4" />} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Students whose account was set up by the office may have no email address on file. Open your lesson
        from the MathVision app instead — the Join button signs you in here by itself.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Team: email or portal username plus password. An enrolled authenticator is
// asked for on /mfa before anything office-only renders.
// ---------------------------------------------------------------------------

function TeamDoor() {
  const [state, formAction] = useFormState<TeamSignInState, FormData>(signInTeam, null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="team-identifier">Email or portal username</Label>
        <Input id="team-identifier" name="identifier" autoComplete="username" placeholder="you@mathvision.sg" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" required />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Submit label="Sign in" icon={<ShieldCheck className="h-4 w-4" />} />
      <p className="text-xs text-muted-foreground">
        Forgotten your password? Reset it in the MathVision app — the room uses the same account.
      </p>
    </form>
  );
}

function Submit({ label, icon }: { label: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </Button>
  );
}
