import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { actingRoleFor, fetchFileViewUrl } from "@/lib/materials/portal";

/** Returns a short-lived signed URL for a file (§6). The portal re-checks the role. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId } = (await request.json()) as { fileId?: string };
  if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });

  try {
    const { url, name } = await fetchFileViewUrl(fileId, actingRoleFor(profile.role));
    return NextResponse.json({ url, name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
