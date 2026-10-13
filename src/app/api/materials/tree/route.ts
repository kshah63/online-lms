import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getLessonRoomState } from "@/lib/data/lessons";
import { canSeeMaterialsAs } from "@/lib/permissions";
import { fetchMaterialsTree } from "@/lib/materials/portal";

/**
 * Server-side proxy to the Materials Portal for a lesson. Keeps the portal
 * service credential off the client. The course comes from the lesson's
 * lesson_course_materials mapping (materials_course_id on lesson_room_state)
 * and the acting role from the viewer's mv-app role plus their seat, so a
 * person with no seat in the lesson sees nothing.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session") ?? "";
  if (!sessionId) return NextResponse.json({ error: "Missing session" }, { status: 400 });

  try {
    const state = await getLessonRoomState(profile, sessionId);
    const role = canSeeMaterialsAs(profile.role, state?.seat ?? null);
    if (!state || !role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const tree = await fetchMaterialsTree(state.materials_course_id ?? "", role);
    return NextResponse.json(tree);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load materials" }, { status: 502 });
  }
}
