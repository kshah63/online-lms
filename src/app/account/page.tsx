import { Clock, ShieldX } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { BrandWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * The plain page a profile lands on when it may not use the room: not yet
 * approved by the office, or closed. The same two states mv-app's root layout
 * routes to /pending and /inactive. Nothing here is a disclosure the person did
 * not already have.
 */
export default function AccountStatusPage({ searchParams }: { searchParams?: { state?: string } }) {
  const inactive = searchParams?.state === "inactive";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <BrandWordmark size={32} textClassName="text-lg" />
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full ${
          inactive ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning-foreground"
        }`}
      >
        {inactive ? <ShieldX className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
      </div>
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold">{inactive ? "This account is not active" : "Your account is waiting for approval"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {inactive
            ? "The office has closed this account, so the lesson room is not available to it. If that is unexpected, get in touch with MathVision."
            : "The office approves new accounts before lessons open. You will be able to join your lessons as soon as that is done."}
        </p>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
