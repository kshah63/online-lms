// ============================================================================
// §6 Materials Portal integration — the API boundary.
// The lessons platform holds a service credential and calls the portal's small
// read API (material repo: /api/v1/*), passing the acting user's effective
// course role so the portal gates teacher-only material. When the portal
// isn't configured, a mock tree is returned so the Materials panel is
// explorable in development.
// ============================================================================

export type ActingRole = "student" | "teacher" | "in_charge" | "admin";

/** The lessons-app role → the portal's acting role (teacher-only gating happens on the portal). */
export function actingRoleFor(role: string): ActingRole {
  if (role === "admin") return "admin";
  if (role === "teacher") return "teacher";
  return "student";
}

export interface MaterialFile {
  id: string;
  name: string;
  size_bytes: number | null;
  mime_type: string;
  teacher_only: boolean;
  created_at?: string;
}

export interface MaterialFolder {
  id: string | null; // null = course root
  name: string;
  folders: MaterialFolder[];
  files: MaterialFile[];
}

export interface MaterialsTree {
  source: "portal" | "mock";
  course: { id: string; name: string; code: string | null } | null;
  root: MaterialFolder;
}

export interface PortalCourse {
  id: string;
  name: string;
  code: string | null;
  archived: boolean;
}

const PORTAL_URL = (process.env.MATERIALS_PORTAL_URL ?? "").replace(/\/+$/, "");
const PORTAL_KEY = process.env.MATERIALS_PORTAL_SERVICE_KEY ?? "";
export const portalConfigured = PORTAL_URL.length > 0 && PORTAL_KEY.length > 0;

function headers(role: ActingRole, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${PORTAL_KEY}`,
    "X-Acting-Role": role,
    ...extra,
  };
}

async function portalJson<T>(path: string, init: RequestInit & { role: ActingRole }): Promise<T> {
  const res = await fetch(`${PORTAL_URL}${path}`, {
    ...init,
    headers: headers(init.role, (init.headers as Record<string, string>) ?? {}),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* no body */
    }
    throw new Error(`Materials portal error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

/** GET /api/v1/courses — for the admin's course mapping. */
export async function listPortalCourses(): Promise<PortalCourse[]> {
  if (!portalConfigured) {
    return [
      { id: "mock-course-igcse", name: "IGCSE Maths (Extended)", code: "IGE", archived: false },
      { id: "mock-course-sat", name: "SAT Maths", code: "SAT", archived: false },
    ];
  }
  const data = await portalJson<{ courses: PortalCourse[] }>("/api/v1/courses", { role: "admin", next: { revalidate: 300 } });
  return data.courses;
}

/** GET /api/v1/courses/{id}/tree — nested folders, filtered by the acting role on the portal. */
export async function fetchMaterialsTree(materialsCourseId: string, role: ActingRole): Promise<MaterialsTree> {
  if (!portalConfigured || !materialsCourseId) return mockTree(role);
  const data = await portalJson<{ course: MaterialsTree["course"]; root: MaterialFolder }>(
    `/api/v1/courses/${encodeURIComponent(materialsCourseId)}/tree`,
    { role, next: { revalidate: 60 } }, // materials change rarely within a lesson
  );
  return { source: "portal", course: data.course, root: data.root };
}

/** POST /api/v1/files/{id}/view-url → short-lived signed URL (60s). */
export async function fetchFileViewUrl(fileId: string, role: ActingRole): Promise<{ url: string; name: string }> {
  if (!portalConfigured) {
    return { url: `https://www.africau.edu/images/default/sample.pdf#file=${encodeURIComponent(fileId)}`, name: `${fileId}.pdf` };
  }
  return portalJson<{ url: string; name: string }>(`/api/v1/files/${encodeURIComponent(fileId)}/view-url`, {
    role,
    method: "POST",
    cache: "no-store",
  });
}

/** Claude's document limit; anything bigger must be split before extraction. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;

/** Download a PDF's bytes (server-side) for the question-extraction pipeline. */
export async function fetchFileBase64(fileId: string, role: ActingRole): Promise<{ base64: string; name: string; bytes: number }> {
  const { url, name } = await fetchFileViewUrl(fileId, role);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not download material (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) throw new Error("This PDF is larger than 32 MB; split it before extracting.");
  return { base64: buf.toString("base64"), name, bytes: buf.byteLength };
}

// --- helpers shared by UI and server -----------------------------------------

export function fileKind(mime: string): "pdf" | "image" | "other" {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

export function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every file in the tree with its folder path, for search and pickers. */
export function flattenFiles(root: MaterialFolder): { file: MaterialFile; path: string[] }[] {
  const out: { file: MaterialFile; path: string[] }[] = [];
  const walk = (f: MaterialFolder, path: string[]) => {
    for (const file of f.files) out.push({ file, path });
    for (const sub of f.folders) walk(sub, [...path, sub.name]);
  };
  walk(root, []);
  return out;
}

function mockTree(role: ActingRole): MaterialsTree {
  const pdf = (id: string, name: string, size: number, teacher_only = false): MaterialFile => ({
    id, name, size_bytes: size, mime_type: "application/pdf", teacher_only,
  });
  const root: MaterialFolder = {
    id: null,
    name: "IGCSE Maths (Extended)",
    files: [pdf("file-syllabus", "Syllabus overview.pdf", 310_000)],
    folders: [
      {
        id: "f-worksheets",
        name: "Worksheets",
        files: [pdf("file-ws-1", "Quadratics — practice set.pdf", 240_000), pdf("file-ws-2", "Completing the square.pdf", 180_000)],
        folders: [
          { id: "f-ws-answers", name: "Answer keys", files: [pdf("file-ws-1-key", "Quadratics — practice set (answers).pdf", 95_000, true)], folders: [] },
        ],
      },
      {
        id: "f-notes",
        name: "Lesson notes",
        files: [pdf("file-nt-1", "Vertex form — summary.pdf", 120_000)],
        folders: [],
      },
    ],
  };
  if (role === "student") {
    // The portal hides teacher-only rows and whole teacher-only folders.
    root.folders[0]!.folders = [];
  } else {
    root.folders.push({
      id: "f-teacher",
      name: "Teacher-only",
      files: [pdf("file-tc-2", "Lesson plan.pdf", 110_000, true)],
      folders: [],
    });
  }
  return { source: "mock", course: { id: "mock-course-igcse", name: root.name, code: "IGE" }, root };
}
