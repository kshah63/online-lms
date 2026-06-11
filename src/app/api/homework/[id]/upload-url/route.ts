import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/people";
import { getHomework } from "@/lib/data/homework";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

/**
 * Mints a one-time signed Storage upload URL so the browser uploads the file
 * DIRECTLY to Supabase (bypassing Vercel's ~4.5 MB function-body limit).
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

  const { name, type, size } = (await req.json()) as { name?: string; type?: string; size?: number };
  if (!name) return NextResponse.json({ error: "Missing file name" }, { status: 400 });
  if (typeof size === "number" && size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 25 MB)." }, { status: 413 });
  }
  if (type && !ALLOWED.includes(type)) {
    return NextResponse.json({ error: "Only PDF or image files are allowed." }, { status: 415 });
  }

  if (isDemoMode) return NextResponse.json({ error: "Demo mode — connect Supabase to upload." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Uploads not configured." }, { status: 500 });

  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${hw.id}/${Date.now()}-${safe}`;
  const { data, error } = await admin.storage.from("homework").createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ path: data.path, token: data.token });
}
