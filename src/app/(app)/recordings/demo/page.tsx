import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/data/auth";

/** Where a recording link lands in demo mode: there is no Daily recording behind the built-in data. */
export default async function DemoRecordingPage() {
  await requireProfile();
  return (
    <div>
      <PageHeader title="Recording" description="Lesson recordings are played from Daily with a short-lived link." />
      <EmptyState
        icon={<PlayCircle className="h-5 w-5" />}
        title="No recording exists in demo mode"
        description="The built-in dataset has no recorded audio behind it. Connected to the MathVision Supabase project with DAILY_API_KEY set, this link opens the lesson's recording for whoever lesson_recordings lets read it — the teacher, the room's in-charge, an admin, and the family while the recording consent is in force."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back</Link>
          </Button>
        }
      />
    </div>
  );
}
