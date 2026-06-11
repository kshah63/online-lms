"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import type { HomeworkCanvas as HomeworkCanvasType } from "@/components/homework/homework-canvas";

// tldraw is browser-only — load the canvas without SSR.
const HomeworkCanvas = dynamic(
  () => import("@/components/homework/homework-canvas").then((m) => m.HomeworkCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening notebook…
      </div>
    ),
  },
);

export function HomeworkCanvasLoader(props: ComponentProps<typeof HomeworkCanvasType>) {
  return <HomeworkCanvas {...props} />;
}
