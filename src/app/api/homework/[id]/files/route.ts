import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/people";
import { getHomework } from "@/lib/data/homework";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import type { HomeworkAttachment } from "@/lib/types";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"];

/** Student/parent (or admin) uploads a PDF/image to a homework submission. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hw = await getHomework(params.id);
  if (!hw) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only the student, their parent, or an admin may upload work.
  const kids = await getChildren(profile);
  const allowed = profile.role === "admin" || kids.some((k) => k.id === hw.student_id);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15 MB)." }, { status: 413 });
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Only PDF or image files are allowed." }, { status: 415 });
  }

  if (isDemoMode) {
    return NextResponse.json({ attachments: hw.attachments, demo: true });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Uploads not configured." }, { status: 500 });

  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${hw.id}/${Date.now()}-${safe}`;
  const { error: upErr } = await admin.storage
    .from("homework")
    .upload(path, await file.arrayBuffer(), { contentType: file.type || "application/octet-stream" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

  const attachments: HomeworkAttachment[] = [
    ...(hw.attachments ?? []),
    { name: file.name, path, size: file.size },
  ];
  const { error: dbErr } = await admin.from("homework").update({ attachments }).eq("id", hw.id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 502 });

  return NextResponse.json({ attachments });
}
