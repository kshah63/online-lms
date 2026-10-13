"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderOpen, ImageIcon, Loader2, Lock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fileKind, flattenFiles, formatSize, type MaterialFile, type MaterialFolder, type MaterialsTree } from "@/lib/materials/portal";
import { cn } from "@/lib/utils";

/**
 * The course's material, as the portal serves it: nested folders, teacher-only
 * rows already filtered by the portal for the caller's role. Opening a file
 * mints a 60-second signed URL through the server proxy.
 */
export function MaterialsPanel({ materialsCourseId }: { materialsCourseId: string | null }) {
  const [tree, setTree] = useState<MaterialsTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/materials/tree?course=${encodeURIComponent(materialsCourseId ?? "")}`);
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

  const matches = useMemo(() => {
    if (!tree || !query.trim()) return null;
    const q = query.trim().toLowerCase();
    return flattenFiles(tree.root).filter(({ file }) => file.name.toLowerCase().includes(q));
  }, [tree, query]);

  const total = useMemo(() => (tree ? flattenFiles(tree.root).length : 0), [tree]);

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

      {total > 6 && (
        <div className="border-b px-3 py-2">
          <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a file…"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading course files…
          </div>
        ) : error ? (
          <p className="p-2 text-sm text-destructive">{error}</p>
        ) : !tree ? null : matches ? (
          <ul className="space-y-0.5">
            {matches.length === 0 && <li className="p-2 text-sm text-muted-foreground">No files match.</li>}
            {matches.map(({ file, path }) => (
              <li key={file.id}>
                <FileRow file={file} hint={path.join(" / ")} opening={opening === file.id} onOpen={() => openFile(file)} />
              </li>
            ))}
          </ul>
        ) : (
          <FolderNode folder={tree.root} depth={0} opening={opening} onOpen={openFile} />
        )}
      </div>
    </div>
  );
}

function FolderNode({
  folder,
  depth,
  opening,
  onOpen,
}: {
  folder: MaterialFolder;
  depth: number;
  opening: string | null;
  onOpen: (f: MaterialFile) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isRoot = folder.id === null;
  const empty = folder.files.length === 0 && folder.folders.length === 0;

  return (
    <div>
      {!isRoot && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-secondary"
          style={{ paddingLeft: 8 + depth * 10 }}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {open ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
          <span className="truncate normal-case tracking-normal">{folder.name}</span>
        </button>
      )}
      {(isRoot || open) && (
        <div className={cn(!isRoot && "ml-1 border-l border-border/60")}>
          {empty && isRoot && <p className="p-2 text-sm text-muted-foreground">No material in this course yet.</p>}
          {folder.folders.map((sub) => (
            <FolderNode key={sub.id ?? sub.name} folder={sub} depth={depth + 1} opening={opening} onOpen={onOpen} />
          ))}
          <ul className="space-y-0.5">
            {folder.files.map((file) => (
              <li key={file.id} style={{ paddingLeft: depth * 10 }}>
                <FileRow file={file} opening={opening === file.id} onOpen={() => onOpen(file)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileRow({ file, hint, opening, onOpen }: { file: MaterialFile; hint?: string; opening: boolean; onOpen: () => void }) {
  const kind = fileKind(file.mime_type);
  return (
    <button
      onClick={onOpen}
      disabled={opening}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
      title={file.name}
    >
      {opening ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : kind === "image" ? (
        <ImageIcon className="h-4 w-4 shrink-0 text-violet-500" />
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-rose-500" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{file.name}</span>
        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatSize(file.size_bytes)}</span>
      {file.teacher_only && <Lock className="h-3 w-3 shrink-0 text-warning-foreground" />}
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
