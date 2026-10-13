"use client";

import { AssetRecordType, createShapeId, type Editor } from "tldraw";

/**
 * Put an image on the notebook at the centre of what the viewer is looking at,
 * scaled to fit the viewport, on the current page. The asset carries a URL,
 * never bytes, so the realtime sync stays small.
 */
export function insertImageIntoNotebook(editor: Editor, img: { src: string; width: number; height: number; name: string }) {
  const bounds = editor.getViewportPageBounds();
  const fit = Math.min(1, (bounds.width * 0.8) / img.width, (bounds.height * 0.9) / img.height);
  const w = img.width * fit;
  const h = img.height * fit;
  const assetId = AssetRecordType.createId();
  editor.createAssets([
    {
      id: assetId,
      typeName: "asset",
      type: "image",
      props: { name: img.name, src: img.src, w: img.width, h: img.height, mimeType: "image/jpeg", isAnimated: false },
      meta: {},
    },
  ]);
  const shapeId = createShapeId();
  editor.createShape({
    id: shapeId,
    type: "image",
    x: bounds.x + (bounds.width - w) / 2,
    y: bounds.y + Math.max(16, (bounds.height - h) / 2),
    props: { assetId, w, h },
  });
  editor.select(shapeId);
  editor.sendToBack([shapeId]);
  return shapeId;
}
