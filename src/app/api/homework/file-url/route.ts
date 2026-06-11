import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getHomework } from "@/lib/data/homework";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

/** Returns a short-lived signed URL for a homework attachment. Anyone who can
 * read the homework (student, parent, teacher-of, admin) may view its files. */
export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { homeworkId, path } = (await req.json()) as { homeworkId?: string; path?: string };
  if (!homeworkId || !path) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  // getHomework is RLS-scoped — returns null unless the caller may read it.
  const hw = await getHomework(homeworkId);
  if (!hw) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(hw.attachments ?? []).some((a) => a.path === path)) {
    return NextResponse.json({ error: "Unknown file" }, { status: 404 });
  }

  if (isDemoMode) return NextResponse.json({ url: null, demo: true });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { data, error } = await admin.storage.from("homework").createSignedUrl(path, 120);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ url: data.signedUrl });
}
