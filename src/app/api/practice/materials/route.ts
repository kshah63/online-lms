import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getMaterialsCourseId } from "@/lib/data/bank";
import { canManageCourse } from "@/lib/permissions-bank";
import { fetchMaterialsTree } from "@/lib/materials/portal";

/**
 * The materials portal's tree for a course the viewer manages, for the bank's
 * worksheet picker. The course is lesson_course_materials' mapping and the
 * acting role is the portal's in_charge (admin for an admin), so teacher-only
 * answer keys are listed. The portal credential stays on the server.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("course") ?? "";
  if (!courseId) return NextResponse.json({ error: "Missing course" }, { status: 400 });

  try {
    if (!(await canManageCourse(profile, courseId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const materialsCourseId = await getMaterialsCourseId(courseId);
    if (!materialsCourseId) {
      return NextResponse.json({ error: "This course is not mapped to a materials course yet; an admin maps it in the MathVision app." }, { status: 404 });
    }
    const tree = await fetchMaterialsTree(materialsCourseId, profile.role === "admin" ? "admin" : "in_charge");
    return NextResponse.json(tree);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load materials" }, { status: 502 });
  }
}
