"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * A diagram for the stem, stored in the practice-images bucket at
 * <course_id>/<uuid>.png with the viewer's own session (the bucket policy
 * checks manages_course on the path's first segment). Anything the browser
 * can decode is re-encoded as PNG so the path's extension is honest.
 */
export function ImageUpload({
  courseId,
  imagePath,
  previewUrl,
  onChange,
  demoMode,
}: {
  courseId: string;
  imagePath: string | null;
  previewUrl: string | null;
  onChange: (path: string | null, previewUrl: string | null) => void;
  demoMode: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const png = await toPng(file);
      const path = `${courseId}/${crypto.randomUUID()}.png`;
      const url = URL.createObjectURL(png);
      if (demoMode) {
        onChange(path, url);
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { error: upErr } = await supabase.storage.from("practice-images").upload(path, png, { contentType: "image/png", upsert: false });
      if (upErr) throw new Error(`practice-images upload failed: ${upErr.message}`);
      onChange(path, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {imagePath ? "Replace image" : "Add an image"}
        </Button>
        {imagePath && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null, null)}>
            <Trash2 /> Remove
          </Button>
        )}
        {imagePath && <span className="truncate text-xs text-muted-foreground" title={imagePath}>{imagePath}</span>}
      </div>
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="max-h-40 rounded-md border bg-white object-contain" />
      )}
      {imagePath && !previewUrl && <p className="text-xs text-muted-foreground">Stored image; it shows to students beside the stem.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

async function toPng(file: File): Promise<Blob> {
  if (file.type === "image/png") return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image as PNG."))), "image/png"));
}
