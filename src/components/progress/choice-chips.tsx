import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A row of choices rendered as links: every option visible, one of them
 * current. Used where a value has a short list of known options (which
 * child, which course) so nothing is ever typed.
 */
export function ChoiceChips({ label, items }: { label: string; items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
            item.active ? "border-primary bg-primary/10 font-medium text-primary" : "border-input bg-card text-foreground hover:bg-secondary",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
