import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getLessonRoomState } from "@/lib/data/lessons";
import { dailyConfigured, ensureRoom, mintToken } from "@/lib/video/daily";
import { consentsToRoomPolicy } from "@/lib/video/daily-config";
import { displayName } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Issues a Daily room URL + meeting token for a lesson, gated on the seat rpc
 * lesson_room_state gives the caller: the host joins as owner (record /
 * transcribe rights); learners and observers join as guests. No seat, no token.
 */
export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let state;
  try {
    state = await getLessonRoomState(profile, params.sessionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Room lookup failed" }, { status: 502 });
  }
  if (!state) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!dailyConfigured) {
    return NextResponse.json({ configured: false, seat: state.seat });
  }

  try {
    const roomUrl = await ensureRoom(state.session_id, consentsToRoomPolicy(state.consents, state.recording_enabled));
    const isOwner = state.seat === "host";
    const token = await mintToken(state.session_id, { userId: profile.id, userName: displayName(profile), isOwner });
    return NextResponse.json({ configured: true, roomUrl, token, isOwner, seat: state.seat });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video provisioning failed" },
      { status: 502 },
    );
  }
}
