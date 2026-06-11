"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, ImageIcon, Loader2, Lock, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MaterialFile, MaterialsTree } from "@/lib/materials/portal";

export function MaterialsPanel({ materialsCourseId }: { materialsCourseId: string | null }) {
  const [tree, setTree] = useState<MaterialsTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/materials/tree?course=${materialsCourseId ?? ""}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed");
        setTree(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [materialsCourseId]);

  async function openFile(file: MaterialFile) {
    setOpening(file.id);
    try {
      const res = await fetch("/api/materials/view-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      });
      const data = await res.json();
      if (res.ok && data.url) window.open(data.url, "_blank", "noopener");
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Materials</span>
        {tree?.source === "mock" && (
          <Badge variant="secondary" className="text-[10px]">
            Sample data
          </Badge>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading course files…
          </div>
        ) : error ? (
          <p className="p-2 text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-4">
            {tree?.folders.map((folder) => (
              <div key={folder.id}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Folder className="h-3.5 w-3.5" />
                  {folder.name}
                </div>
                <ul className="space-y-1">
                  {folder.files.map((file) => (
                    <li key={file.id}>
                      <button
                        onClick={() => openFile(file)}
                        disabled={opening === file.id}
                        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        {opening === file.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : file.type === "image" ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-violet-500" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-rose-500" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        {file.teacher_only && <Lock className="h-3 w-3 shrink-0 text-warning-foreground" />}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
