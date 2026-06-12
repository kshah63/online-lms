"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/brand";

/**
 * Second step of sign-in for accounts with TOTP 2FA enrolled: enter the 6-digit
 * code from the authenticator app to upgrade the session to AAL2.
 */
export default function MfaChallengePage() {
  const router = useRouter();
  const supabase = useRef(createSupabaseBrowserClient()).current;
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = (data?.totp ?? []).find((f) => f.status === "verified");
      if (!totp) {
        // Nothing to challenge (no factor, or already AAL2) — go home.
        router.replace("/");
        return;
      }
      setFactorId(totp.id);
    })();
  }, [supabase, router]);

  async function verify() {
    if (!supabase || !factorId || code.length < 6) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setError("That code didn't work — check your authenticator app and try again.");
      setBusy(false);
      return;
    }
    // Full page navigation so the server picks up the upgraded (AAL2) session.
    window.location.href = "/";
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <BrandWordmark size={32} textClassName="text-lg" />
        </div>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">Two-factor authentication</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app to finish signing in.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="code">Authentication code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.4em]"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || !factorId || code.length < 6}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify
          </Button>
        </form>
      </div>
    </div>
  );
}
