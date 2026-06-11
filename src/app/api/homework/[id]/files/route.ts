import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/people";
import { getHomework } from "@/lib/data/homework";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import type { HomeworkAttachment } from "@/lib/types";

/**
 * Records an attachment AFTER the browser uploaded it straight to Storage via
 * the signed URL (see ./upload-url). Only a small JSON body passes through here.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hw = await getHomework(params.id);
  if (!hw) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const kids = await getChildren(profile);
  if (!(profile.role === "admin" || kids.some((k) => k.id === hw.student_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, path, size } = (await req.json()) as { name?: string; path?: string; size?: number };
  if (!name || !path) return NextResponse.json({ error: "Missing file info" }, { status: 400 });
  // The path must belong to this homework's folder.
  if (!path.startsWith(`${hw.id}/`)) return NextResponse.json({ error: "Bad path" }, { status: 400 });

  if (isDemoMode) return NextResponse.json({ attachments: hw.attachments ?? [] });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Uploads not configured." }, { status: 500 });

  const attachments: HomeworkAttachment[] = [
    ...(hw.attachments ?? []),
    { name, path, size: size ?? 0 },
  ];
  const { error } = await admin.from("homework").update({ attachments }).eq("id", hw.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ attachments });
}
