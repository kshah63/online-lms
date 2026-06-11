import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { fetchMaterialsTree } from "@/lib/materials/portal";

/**
 * Server-side proxy to the Materials Portal (§6). Keeps the portal service
 * credential off the client and passes the caller's effective course role.
 */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const materialsCourseId = searchParams.get("course") ?? "";
  // Effective course role: teachers get teacher-gated material, everyone else student.
  const role = profile.role === "teacher" || profile.role === "admin" ? "teacher" : "student";

  try {
    const tree = await fetchMaterialsTree(materialsCourseId, role);
    return NextResponse.json(tree);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load materials" },
      { status: 502 },
    );
  }
}
