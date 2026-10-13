import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getLessonRoomState } from "@/lib/data/lessons";
import { canSeeMaterialsAs } from "@/lib/permissions";
import { fetchFileViewUrl } from "@/lib/materials/portal";

/** Returns a short-lived signed URL for a file, acting as the viewer's seat in the lesson. The portal re-checks the role. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId, sessionId } = (await request.json()) as { fileId?: string; sessionId?: string };
  if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

  try {
    const state = await getLessonRoomState(profile, sessionId);
    const role = canSeeMaterialsAs(profile.role, state?.seat ?? null);
    if (!state || !role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { url, name } = await fetchFileViewUrl(fileId, role);
    return NextResponse.json({ url, name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
