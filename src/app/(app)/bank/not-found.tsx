import Link from "next/link";
import { ChevronLeft, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * rpc manages_course said no, or the viewer manages no course at all: a
 * teacher, a family, support without an in-charge seat, or an in-charge of
 * another room. The two are deliberately indistinguishable.
 */
export default function BankNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldX className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">This question bank isn&rsquo;t open to you</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          The bank is run by the in-charge of each course&rsquo;s room and by admins. If that is you, ask an admin to add you as the room&rsquo;s in-charge in the MathVision app.
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
