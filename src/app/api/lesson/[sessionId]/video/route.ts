import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getChildren } from "@/lib/data/people";
import { dailyConfigured, ensureRoom, mintToken } from "@/lib/video/daily";

/**
 * Issues a Daily room URL + meeting token for a lesson. Re-enforces §4:
 * a teacher may only join a session they are assigned to. The assigned teacher
 * joins as owner (record/transcribe rights); the student joins as a guest.
 */
export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await getSessionById(params.sessionId);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isTeacher = profile.role === "teacher";
  let allowed = profile.role === "admin";
  if (isTeacher) allowed = session.teacher_id === profile.id;
  if (profile.role === "student") allowed = session.student_id === profile.id;
  if (profile.role === "parent") {
    const children = await getChildren(profile);
    allowed = children.some((c) => c.id === session.student_id);
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!dailyConfigured) {
    return NextResponse.json({ configured: false });
  }

  try {
    const roomUrl = await ensureRoom(session.id);
    const isOwner = isTeacher || profile.role === "admin";
    const token = await mintToken(session.id, profile.display_name, isOwner);
    return NextResponse.json({ configured: true, roomUrl, token, isOwner });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video provisioning failed" },
      { status: 502 },
    );
  }
}
