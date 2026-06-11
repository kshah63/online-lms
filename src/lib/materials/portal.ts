// ============================================================================
// §6 Materials Portal integration — the API boundary.
// The lessons platform holds a service credential and calls the portal's small
// read API, passing the acting user's effective course role so the portal's own
// RLS gates teacher-only material. When the portal isn't configured, a mock
// tree is returned so the Materials panel is explorable in development.
// ============================================================================

export interface MaterialFile {
  id: string;
  name: string;
  type: "pdf" | "image" | "doc" | "other";
  size?: string;
  teacher_only?: boolean;
}

export interface MaterialFolder {
  id: string;
  name: string;
  files: MaterialFile[];
}

export interface MaterialsTree {
  source: "portal" | "mock";
  folders: MaterialFolder[];
}

const PORTAL_URL = process.env.MATERIALS_PORTAL_URL ?? "";
const PORTAL_KEY = process.env.MATERIALS_PORTAL_SERVICE_KEY ?? "";
const portalConfigured = PORTAL_URL.length > 0 && PORTAL_KEY.length > 0;

/** GET /api/v1/courses/{materials_course_id}/tree?role={student|teacher} */
export async function fetchMaterialsTree(
  materialsCourseId: string,
  role: "student" | "teacher",
): Promise<MaterialsTree> {
  if (!portalConfigured || !materialsCourseId) {
    return mockTree(role);
  }

  const res = await fetch(
    `${PORTAL_URL}/api/v1/courses/${materialsCourseId}/tree?role=${role}`,
    {
      headers: {
        Authorization: `Bearer ${PORTAL_KEY}`,
        "X-Acting-Role": role, // the portal does the authorization
      },
      // materials change rarely within a lesson; small cache is fine
      next: { revalidate: 60 },
    },
  );
  if (!res.ok) throw new Error(`Materials portal error: ${res.status}`);
  const data = (await res.json()) as { folders: MaterialFolder[] };
  return { source: "portal", folders: data.folders };
}

/** POST /api/v1/files/{file_id}/view-url → short-lived signed URL. */
export async function fetchFileViewUrl(
  fileId: string,
  role: "student" | "teacher",
): Promise<string> {
  if (!portalConfigured) {
    // Mock: a placeholder PDF so the "open" action does something in dev.
    return `https://www.africau.edu/images/default/sample.pdf#file=${encodeURIComponent(fileId)}`;
  }

  const res = await fetch(`${PORTAL_URL}/api/v1/files/${fileId}/view-url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PORTAL_KEY}`,
      "X-Acting-Role": role,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Materials portal error: ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

function mockTree(role: "student" | "teacher"): MaterialsTree {
  const folders: MaterialFolder[] = [
    {
      id: "f-worksheets",
      name: "Worksheets",
      files: [
        { id: "file-ws-1", name: "Quadratics — practice set.pdf", type: "pdf", size: "240 KB" },
        { id: "file-ws-2", name: "Completing the square.pdf", type: "pdf", size: "180 KB" },
      ],
    },
    {
      id: "f-notes",
      name: "Lesson notes",
      files: [
        { id: "file-nt-1", name: "Vertex form — summary.pdf", type: "pdf", size: "120 KB" },
        { id: "file-nt-2", name: "Reference diagram.png", type: "image", size: "85 KB" },
      ],
    },
  ];

  if (role === "teacher") {
    folders.push({
      id: "f-teacher",
      name: "Teacher-only",
      files: [
        { id: "file-tc-1", name: "Answer key.pdf", type: "pdf", size: "95 KB", teacher_only: true },
        { id: "file-tc-2", name: "Lesson plan.pdf", type: "pdf", size: "110 KB", teacher_only: true },
      ],
    });
  }

  return { source: "mock", folders };
}
