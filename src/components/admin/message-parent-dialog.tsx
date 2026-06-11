"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendParentMessage } from "@/lib/actions/messaging";

export function MessageParentDialog({
  studentId,
  followupId,
  parentName,
  hasPhone,
  defaultBody,
}: {
  studentId: string;
  followupId: string;
  parentName: string | null;
  hasPhone: boolean;
  defaultBody: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(defaultBody);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function send() {
    start(async () => {
      const res = await sendParentMessage({ studentId, followupId, body });
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) setTimeout(() => setOpen(false), 1000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!hasPhone} title={hasPhone ? "Message parent on WhatsApp" : "No parent phone on file"}>
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message {parentName ?? "parent"}</DialogTitle>
          <DialogDescription>Sends a WhatsApp message. Without a provider configured it&rsquo;s simulated and logged.</DialogDescription>
        </DialogHeader>
        <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}
        <DialogFooter>
          <Button onClick={send} disabled={pending || !body.trim()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
