"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

/**
 * Markdown + LaTeX for question stems, options, solutions and feedback.
 * $…$ inline and $$…$$ display maths render with KaTeX; GFM tables and lists
 * work for marking schemes. Inline (`inline`) renders without block margins
 * so an option label sits on one line.
 */
export function MathMarkdown({ source, inline = false, className }: { source: string; inline?: boolean; className?: string }) {
  return (
    <div className={cn("math-markdown", inline ? "inline [&>p]:inline [&>p]:m-0" : "space-y-2 [&_table]:text-sm [&_li]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
