"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, Upload } from "lucide-react";
import type { HomeworkAttachment } from "@/lib/types";

export function AttachmentsBar({
  homeworkId,
  initial,
  canUpload,
}: {
  homeworkId: string;
  initial: HomeworkAttachment[];
  canUpload: boolean;
}) {
  const [files, setFiles] = useState<HomeworkAttachment[]>(initial ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/homework/${homeworkId}/files`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setFiles(data.attachments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function open(path: string) {
    setOpening(path);
    try {
      const res = await fetch("/api/homework/file-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeworkId, path }),
      });
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank", "noopener");
      else if (data.demo) setError("Demo mode — file viewing needs a connected project.");
    } finally {
      setOpening(null);
    }
  }

  if (!canUpload && files.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2 text-sm">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" /> Attachments
      </span>
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => open(f.path)}
          disabled={opening === f.path}
          className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs hover:bg-secondary"
        >
          {opening === f.path ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : f.name.toLowerCase().endsWith(".pdf") ? (
            <FileText className="h-3.5 w-3.5 text-rose-500" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5 text-violet-500" />
          )}
          <span className="max-w-[180px] truncate">{f.name}</span>
        </button>
      ))}
      {canUpload && (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload PDF / image
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={upload}
          />
        </>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
