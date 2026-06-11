"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shows the one-time temporary password for a freshly-provisioned account. */
export function TempPassword({ email, password, onDone }: { email: string; password: string; onDone?: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Email: ${email}\nTemporary password: ${password}`;

  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-success/40 bg-success/5 p-4">
        <p className="text-sm font-medium text-success">Account created ✓</p>
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Email:</span> {email}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Temporary password:</span>{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-sm">{password}</code>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Share these with the person — they can change the password after signing in. This won&rsquo;t be shown again.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {onDone && (
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
