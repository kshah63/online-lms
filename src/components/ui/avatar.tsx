import * as React from "react";
import { avatarColor, cn, initials } from "@/lib/utils";

/**
 * Lightweight avatar: shows an image if provided, else colored initials.
 * (Kept dependency-free; Radix Avatar isn't needed for this fallback behavior.)
 */
export function Avatar({
  name,
  src,
  className,
  size = 36,
}: {
  name: string;
  src?: string | null;
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white ring-2 ring-card",
        !src && avatarColor(name),
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
