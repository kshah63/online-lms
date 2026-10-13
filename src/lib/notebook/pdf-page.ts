"use client";

// ============================================================================
// Render one page of a PDF to an image in the browser (pdf.js), so a worksheet
// page can sit on the shared whiteboard and both people can write on it.
// ============================================================================

export interface RenderedPage {
  dataUrl: string; // image/jpeg
  width: number;
  height: number;
  pageCount: number;
}

let workerConfigured = false;

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerConfigured = true;
  }
  return lib;
}

/** How many pages a PDF has (fetched once; cheap for worksheets). */
export async function pdfPageCount(url: string): Promise<number> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ url, withCredentials: false }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

/**
 * Render page `pageNumber` (1-based) at a width that reads well on the canvas
 * (~1400px wide max). JPEG keeps the payload small enough to upload and sync.
 */
export async function renderPdfPage(url: string, pageNumber: number, maxWidth = 1400): Promise<RenderedPage> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ url, withCredentials: false }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxWidth / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height, pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
