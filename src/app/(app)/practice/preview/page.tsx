import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/env";
import { PageHeader } from "@/components/page-header";
import { PracticePreview } from "./preview";

/** Demo-mode only: a place to look at the practice UI with sample questions. */
export default function PracticePreviewPage() {
  if (!isDemoMode) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title="Practice preview" description="Sample questions rendering through the practice runner (demo mode only)." />
      <PracticePreview />
    </div>
  );
}
