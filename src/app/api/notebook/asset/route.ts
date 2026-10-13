import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";

/**
 * Accepts a rendered worksheet page (or a photo) for the notebook and returns
 * a URL the tldraw asset can point at. online-lms stored it in its own
 * `notebook-assets` bucket through a service-role client; the room holds no
 * service-role key on mv-app's project and mv-app defines no bucket for
 * notebook images yet, so the data URL is handed back as-is and travels
 * inside the snapshot (save_lesson_notebook) and the notebook sync.
 * TODO(mv-app): a notebook-images bucket with RLS, uploaded through the
 * viewer's own session, then a signed URL here instead of the bytes.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { dataUrl?: string; name?: string; notebookId?: string };
  const dataUrl = body.dataUrl ?? "";
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) return NextResponse.json({ error: "Expected a JPEG, PNG or WebP data URL" }, { status: 400 });
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: "Image too large (max 6 MB)" }, { status: 413 });

  return NextResponse.json({ url: dataUrl });
}
