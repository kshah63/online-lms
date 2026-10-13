"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, FileText, Loader2, Lock, Search } from "lucide-react";
import { fileKind, formatSize, type MaterialFile } from "@/lib/materials/portal";
import { cn } from "@/lib/utils";

export interface PickableFile {
  file: MaterialFile;
  path: string[];
}

/**
 * Pick one PDF from the course's materials tree (served by /api/practice/
 * materials for the course). The typing filters a real list; the result is a
 * file id the portal knows, never a name somebody spelled.
 */
export function MaterialsPicker({
  label,
  files,
  loading,
  error,
  value,
  onChange,
  onOpen,
  excludeId,
  optional,
}: {
  label: string;
  files: PickableFile[];
  loading: boolean;
  error: string | null;
  value: { fileId: string; name: string } | null;
  onChange: (v: { fileId: string; name: string } | null) => void;
  onOpen?: (fileId: string) => void;
  excludeId?: string | null;
  optional?: boolean;
}) {
  const [query, setQuery] = useState("");
  const pdfs = useMemo(() => files.filter(({ file }) => fileKind(file.mime_type) === "pdf" && file.id !== excludeId), [files, excludeId]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pdfs.filter(({ file, path }) => `${path.join("/")}/${file.name}`.toLowerCase().includes(q)) : pdfs;
  }, [pdfs, query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {label}
          {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>}
        </span>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>
      {pdfs.length > 6 && (
        <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file…" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label={`Find a file for ${label}`} />
        </label>
      )}
      <div className="max-h-56 overflow-y-auto rounded-md border">
        {loading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading course files…
          </div>
        ) : error ? (
          <p className="p-3 text-sm text-destructive">{error}</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{pdfs.length === 0 ? "No PDFs in this course's materials." : "No files match."}</p>
        ) : (
          <ul className="divide-y">
            {shown.map(({ file, path }) => {
              const chosen = value?.fileId === file.id;
              return (
                <li key={file.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => onChange(chosen ? null : { fileId: file.id, name: file.name })}
                    className={cn("flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary", chosen && "bg-primary/10")}
                    title={file.name}
                  >
                    {chosen ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <FileText className="h-4 w-4 shrink-0 text-rose-500" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{file.name}</span>
                      {path.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">{path.join(" / ")}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatSize(file.size_bytes)}</span>
                    {file.teacher_only && <Lock className="h-3 w-3 shrink-0 text-warning-foreground" aria-label="Teacher-only" />}
                  </button>
                  {onOpen && (
                    <button type="button" onClick={() => onOpen(file.id)} className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-primary group-hover:opacity-100 focus:opacity-100" title="Open in a new tab" aria-label={`Open ${file.name}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
