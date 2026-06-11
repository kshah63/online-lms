import { Badge } from "@/components/ui/badge";
import { SESSION_STATUS_LABEL, type SessionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const VARIANT: Record<SessionStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  scheduled: "secondary",
  confirmed: "default",
  in_progress: "success",
  completed: "secondary",
  cancelled: "destructive",
  no_show: "warning",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge variant={VARIANT[status]}>
      {status === "in_progress" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
      )}
      {SESSION_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Small colored dot used in dense rows. */
export function StatusDot({ status, className }: { status: SessionStatus; className?: string }) {
  const color: Record<SessionStatus, string> = {
    scheduled: "bg-muted-foreground/50",
    confirmed: "bg-primary",
    in_progress: "bg-success",
    completed: "bg-muted-foreground/40",
    cancelled: "bg-destructive",
    no_show: "bg-warning",
  };
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", color[status], className)} />;
}
