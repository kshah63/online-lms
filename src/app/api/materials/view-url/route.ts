import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { fetchFileViewUrl } from "@/lib/materials/portal";

/** Returns a short-lived signed URL for a file (§6). Portal re-checks the role. */
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId } = (await request.json()) as { fileId?: string };
  if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });

  const role = profile.role === "teacher" || profile.role === "admin" ? "teacher" : "student";
  try {
    const url = await fetchFileViewUrl(fileId, role);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 502 },
    );
  }
}
