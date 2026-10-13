"use client";

import { cn } from "@/lib/utils";

/**
 * A value with known options is picked from a row of chips, every option
 * visible without a tap. `multiple` makes each chip a toggle.
 */
export function ChipRow<T extends string | number | null>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  options: readonly { value: T; label: string; hint?: string; disabled?: boolean }[];
  value: T | readonly T[];
  onChange: (value: T) => void;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const selected = (v: T) => (Array.isArray(value) ? (value as readonly T[]).includes(v) : value === v);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label={label}>
      {label && <span className="mr-1 text-xs font-medium text-muted-foreground">{label}</span>}
      {options.map((o) => {
        const active = selected(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            disabled={o.disabled}
            aria-pressed={active}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-xs",
              active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
