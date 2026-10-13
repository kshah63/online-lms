import { Badge } from "@/components/ui/badge";
import { SESSION_STATUS_LABEL, type SessionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const VARIANT: Record<SessionStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  pending: "secondary",
  alternate_proposed: "warning",
  confirmed: "default",
  declined: "destructive",
  cancelled: "destructive",
  completed: "secondary",
};

/** session_requests.status, as a badge. "Live now" is the room's own state, not a status. */
export function StatusBadge({ status }: { status: SessionStatus }) {
  return <Badge variant={VARIANT[status]}>{SESSION_STATUS_LABEL[status]}</Badge>;
}

/** Small colored dot used in dense rows. */
export function StatusDot({ status, className }: { status: SessionStatus; className?: string }) {
  const color: Record<SessionStatus, string> = {
    pending: "bg-muted-foreground/50",
    alternate_proposed: "bg-warning",
    confirmed: "bg-primary",
    declined: "bg-destructive",
    cancelled: "bg-destructive",
    completed: "bg-muted-foreground/40",
  };
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", color[status], className)} />;
}
