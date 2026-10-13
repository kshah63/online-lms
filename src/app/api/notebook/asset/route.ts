import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

/**
 * Stores a rendered worksheet page (or a photo) for the notebook and returns
 * a URL the tldraw asset can point at, so the realtime sync carries a link
 * rather than the image bytes. Bucket: `notebook-assets` (private; signed
 * URLs). In demo mode the data URL is returned as-is.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { dataUrl?: string; name?: string; notebookId?: string };
  const dataUrl = body.dataUrl ?? "";
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) return NextResponse.json({ error: "Expected a JPEG, PNG or WebP data URL" }, { status: 400 });
  const mime = match[1]!;
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: "Image too large (max 6 MB)" }, { status: 413 });

  if (isDemoMode) return NextResponse.json({ url: dataUrl });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const safeName = (body.name ?? "page").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60);
  const path = `${body.notebookId ?? "misc"}/${Date.now()}-${safeName}.${ext}`;
  const { error } = await admin.storage.from("notebook-assets").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data, error: signErr } = await admin.storage.from("notebook-assets").createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signErr || !data) return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, path });
}
