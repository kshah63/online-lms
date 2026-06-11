"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TempPassword } from "@/components/admin/temp-password";
import { approveAccountRequest, rejectAccountRequest, type ProvisionResult } from "@/lib/actions/accounts";
import type { AccountRequest } from "@/lib/data/people";

export function AccountRequests({ requests }: { requests: AccountRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <Card className="mb-6 border-primary/30 bg-accent/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Account requests ({requests.length})</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {requests.map((r) => (
          <RequestRow key={r.id} req={r} />
        ))}
      </CardContent>
    </Card>
  );
}

function RequestRow({ req }: { req: AccountRequest }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [done, setDone] = useState(false);

  if (result?.ok && result.tempPassword) {
    return (
      <div className="py-3">
        <TempPassword email={result.email ?? req.email} password={result.tempPassword} />
      </div>
    );
  }
  if (done) {
    return (
      <div className="py-3 text-sm text-muted-foreground">
        {req.display_name} — request closed.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <Avatar name={req.display_name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{req.display_name}</span>
          <Badge variant="secondary" className="capitalize">
            {req.role}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {req.email} · {req.timezone.replace(/_/g, " ")}
          {req.message ? ` · “${req.message}”` : ""}
        </div>
      </div>
      {result && !result.ok && <span className="text-xs text-destructive">{result.message}</span>}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={pending}
          onClick={() => start(async () => { await rejectAccountRequest(req.id); setDone(true); })}
        >
          <X className="h-4 w-4" /> Reject
        </Button>
        <Button
          size="sm"
          variant="success"
          disabled={pending}
          onClick={() => start(async () => setResult(await approveAccountRequest(req.id)))}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Approve
        </Button>
      </div>
    </div>
  );
}
