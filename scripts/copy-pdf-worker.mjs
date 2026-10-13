// Copies pdf.js's worker next to the app so the browser can load it from our
// origin (no CDN dependency). Runs on postinstall; the copy is git-ignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(here, "..", "public", "pdf.worker.min.mjs");
try {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("copied pdf.worker.min.mjs to public/");
} catch (e) {
  console.warn("pdf worker not copied:", e instanceof Error ? e.message : e);
}
