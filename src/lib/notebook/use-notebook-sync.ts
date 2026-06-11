"use client";

import { useCallback, useRef } from "react";
import {
  atom,
  createPresenceStateDerivation,
  getSnapshot,
  loadSnapshot,
  react,
  type Editor,
  type TLRecord,
  type TLStoreSnapshot,
} from "tldraw";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { saveNotebookSnapshot } from "@/lib/actions/notebook";

// ============================================================================
// §5 Real-time collaborative notebook sync on Supabase Realtime.
//   - document changes broadcast both ways and merge as remote changes
//   - presence (live cursors) broadcast with staleness cleanup
//   - the running document is persisted to `notebooks.tldraw_snapshot`
// When Supabase isn't configured, returns no onMount and the caller falls back
// to tldraw's local IndexedDB persistence.
// ============================================================================

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

interface SyncArgs {
  notebookId: string;
  userId: string;
  userName: string;
  initialSnapshot: unknown | null;
}

export function useNotebookSync({ notebookId, userId, userName, initialSnapshot }: SyncArgs) {
  const supabase = createSupabaseBrowserClient();
  const cleanupRef = useRef<(() => void) | null>(null);

  const onMount = useCallback(
    (editor: Editor) => {
      // 1. Load the running document.
      if (initialSnapshot) {
        try {
          loadSnapshot(editor.store, initialSnapshot as TLStoreSnapshot);
        } catch (e) {
          console.warn("Failed to load notebook snapshot", e);
        }
      }

      if (!supabase) return; // local-only mode

      const color = AVATAR_COLORS[Math.abs(hash(userId)) % AVATAR_COLORS.length];
      const channel = supabase.channel(`notebook:${notebookId}`, {
        config: { broadcast: { self: false } },
      });

      // 2. Broadcast local document edits.
      const stopDocListen = editor.store.listen(
        (entry) => {
          channel.send({ type: "broadcast", event: "changes", payload: entry.changes });
        },
        { source: "user", scope: "document" },
      );

      // 3. Apply remote document edits as remote changes (no echo).
      channel.on("broadcast", { event: "changes" }, ({ payload }) => {
        const { added, updated, removed } = payload as {
          added: Record<string, TLRecord>;
          updated: Record<string, [TLRecord, TLRecord]>;
          removed: Record<string, TLRecord>;
        };
        editor.store.mergeRemoteChanges(() => {
          const toPut = [...Object.values(added), ...Object.values(updated).map(([, next]) => next)];
          if (toPut.length) editor.store.put(toPut);
          const toRemove = Object.keys(removed) as TLRecord["id"][];
          if (toRemove.length) editor.store.remove(toRemove);
        });
      });

      // 4. Presence — broadcast our cursor; render peers'.
      const userPrefs = atom("userPrefs", { id: userId, color, name: userName });
      const presence = createPresenceStateDerivation(userPrefs)(editor.store);
      const lastSeen = new Map<string, number>();

      const stopPresence = react("broadcast-presence", () => {
        const p = presence.get();
        if (p) channel.send({ type: "broadcast", event: "presence", payload: p });
      });

      channel.on("broadcast", { event: "presence" }, ({ payload }) => {
        const record = payload as TLRecord;
        lastSeen.set(record.id, Date.now());
        editor.store.mergeRemoteChanges(() => editor.store.put([record]));
      });

      // Drop stale cursors (peer left / went idle).
      const sweep = setInterval(() => {
        const now = Date.now();
        for (const [id, ts] of lastSeen) {
          if (now - ts > 10_000) {
            lastSeen.delete(id);
            editor.store.mergeRemoteChanges(() => editor.store.remove([id as TLRecord["id"]]));
          }
        }
      }, 5_000);

      // 5. Persist the running document (debounced).
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      const stopSaveListen = editor.store.listen(
        () => {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            const snap = getSnapshot(editor.store);
            void saveNotebookSnapshot(notebookId, snap).catch(() => {});
          }, 2_000);
        },
        { source: "user", scope: "document" },
      );

      channel.subscribe();

      cleanupRef.current = () => {
        stopDocListen();
        stopPresence();
        stopSaveListen();
        clearInterval(sweep);
        if (saveTimer) clearTimeout(saveTimer);
        supabase.removeChannel(channel);
      };
    },
    [supabase, notebookId, userId, userName, initialSnapshot],
  );

  const dispose = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  return { onMount, dispose, syncing: Boolean(supabase) };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return h;
}
