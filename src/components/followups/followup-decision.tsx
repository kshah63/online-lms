"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveFollowupAction, dismissFollowupAction } from "@/lib/actions/followups";
import type { FollowupAction, FollowupStatus } from "@/lib/types";

/**
 * Approve or dismiss one follow-up. For a message to the parent the approver
 * may edit the wording first (the database prefixes "From <teacher>'s lesson
 * today:" and sends it as the approver). Who may decide is the database's
 * rule; its sentence is shown when it refuses.
 */
export function FollowupDecision({
  id,
  action,
  status,
  suggestedParentMessage,
}: {
  id: string;
  action: FollowupAction;
  status: FollowupStatus;
  suggestedParentMessage: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestedParentMessage ?? "");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  if (status !== "proposed" && status !== "approved") return null;

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const result = await fn();
      setNotice(result);
      if (result.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  return (
    <div className="flex w-full flex-col gap-2">
      {editing && action === "share_with_parent" && (
        <textarea
          className="min-h-[72px] w-full rounded-md border bg-background p-2 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Message to the parent"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {action === "share_with_parent" && !editing ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
            <Check className="h-3.5 w-3.5" /> Approve &amp; send…
          </Button>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => run(() => approveFollowupAction({ id, text: editing ? text : undefined }))}>
            <Check className="h-3.5 w-3.5" /> {action === "share_with_parent" ? "Send to the parent" : "Approve"}
          </Button>
        )}
        {editing && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissFollowupAction({ id }))}>
          <X className="h-3.5 w-3.5" /> Dismiss
        </Button>
        {notice && <span className={notice.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{notice.message}</span>}
      </div>
    </div>
  );
}
