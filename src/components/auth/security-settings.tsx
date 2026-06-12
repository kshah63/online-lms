"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { updatePassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

// ============================================================================
// Account security: change password + TOTP two-factor auth (enroll / remove).
// All of it runs against Supabase Auth from the browser; RLS/auth policies do
// the enforcement.
// ============================================================================

export function SecuritySettings({ demoMode }: { demoMode: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChangePasswordCard demoMode={demoMode} />
      <TwoFactorCard demoMode={demoMode} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------

type PwState = { ok: boolean; message: string } | null;

function ChangePasswordCard({ demoMode }: { demoMode: boolean }) {
  const [state, formAction] = useFormState<PwState, FormData>(
    async (_, fd) =>
      demoMode ? { ok: true, message: "Demo mode: password not changed." } : updatePassword(fd),
    null,
  );

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Password</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Use at least 8 characters.</p>

      <form action={formAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" minLength={8} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" name="confirm" type="password" minLength={8} required />
        </div>
        {state && (
          <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>{state.message}</p>
        )}
        <PwSubmit />
      </form>
    </section>
  );
}

function PwSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Update password
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Two-factor (TOTP)
// ---------------------------------------------------------------------------

type Enrolling = { factorId: string; qr: string; secret: string };

function TwoFactorCard({ demoMode }: { demoMode: boolean }) {
  const supabase = useRef(createSupabaseBrowserClient()).current;
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    if (!supabase) {
      setLoaded(true);
      return;
    }
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = (data?.totp ?? []).find((f) => f.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    // Clear any abandoned unverified enrollments first (Supabase keeps them).
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.totp ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? "Couldn't start enrollment.");
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll() {
    if (!supabase || !enrolling || code.length < 6) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code,
    });
    setBusy(false);
    if (error) {
      setError("That code didn't match — scan the QR again or re-enter the code.");
      return;
    }
    setEnrolling(null);
    setCode("");
    await refresh();
  }

  async function disable() {
    if (!supabase || !verifiedFactorId) return;
    if (!window.confirm("Turn off two-factor authentication for your account?")) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
    setBusy(false);
    await refresh();
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Two-factor authentication</h2>
        {loaded &&
          (verifiedFactorId ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>)}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Adds a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy…) at
        sign-in. Strongly recommended for admin accounts.
      </p>

      {demoMode ? (
        <p className="text-sm text-muted-foreground">Not available in demo mode.</p>
      ) : !loaded ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : enrolling ? (
        <div className="space-y-3">
          <p className="text-sm">1. Scan this QR code with your authenticator app:</p>
          {/* Supabase returns the QR as an SVG data URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qr} alt="TOTP enrollment QR code" className="h-40 w-40 rounded-lg border bg-white p-2" />
          <p className="text-xs text-muted-foreground">
            Can&rsquo;t scan? Enter this secret manually:{" "}
            <code className="rounded bg-secondary px-1 py-0.5">{enrolling.secret}</code>
          </p>
          <p className="text-sm">2. Enter the 6-digit code it shows:</p>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-36 text-center tracking-[0.3em]"
            />
            <Button onClick={() => void confirmEnroll()} disabled={busy || code.length < 6}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Activate
            </Button>
            <Button variant="ghost" onClick={() => setEnrolling(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      ) : verifiedFactorId ? (
        <div className="space-y-3">
          <p className="text-sm">
            Two-factor is <span className="font-medium">active</span>. You&rsquo;ll be asked for a code at
            every sign-in.
          </p>
          <Button variant="outline" onClick={() => void disable()} disabled={busy}>
            <ShieldOff className="h-4 w-4" /> Turn off 2FA
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={() => void startEnroll()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Set up 2FA
          </Button>
        </div>
      )}
    </section>
  );
}
