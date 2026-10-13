import { notFound, redirect } from "next/navigation";
import { isDemoMode } from "@/lib/env";

/** Demo-mode only: the report editor used to have a sandbox here; it now opens the demo lesson that is awaiting a report. */
export default function ReportPreviewPage() {
  if (!isDemoMode) notFound();
  redirect("/teacher/reports/20000000-0000-0000-0000-000000000006");
}
