import Link from "next/link";
import { ChevronLeft, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

/** rpc manages_course said no, or there is no such course. The two are deliberately indistinguishable. */
export default function SyllabusNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldX className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">This syllabus isn&rsquo;t open to you</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          A course&rsquo;s syllabus is edited by the in-charge of its room and by admins, and there may be no such course.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">
          <ChevronLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
    </div>
  );
}
