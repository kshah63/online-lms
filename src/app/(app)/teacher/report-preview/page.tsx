import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/env";
import { PageHeader } from "@/components/page-header";
import { ReportPreview } from "./preview";

/** Demo-mode only: the centre-format session report editor with the demo lesson. */
export default function ReportPreviewPage() {
  if (!isDemoMode) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title="Session report (preview)" description="The centre's per-session report form, drafted from the demo lesson (demo mode only)." />
      <ReportPreview />
    </div>
  );
}
