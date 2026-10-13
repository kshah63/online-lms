import Link from "next/link";
import { ChevronLeft, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * rpc lesson_room_state returned no row: either session_requests has no such
 * booking, or room_access gives this viewer no seat (not their lesson, not
 * their room, or outside the window from 15 minutes before the start to 30
 * minutes after the end). The two are deliberately indistinguishable.
 */
export default function LessonNotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldX className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">This lesson isn&rsquo;t open to you</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          There is no online lesson here for your account, or the room is not open yet. Rooms open 15 minutes
          before the booked start. If this is your lesson, open it from the MathVision app.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">
          <ChevronLeft className="h-4 w-4" /> Back to your lessons
        </Link>
      </Button>
    </div>
  );
}
