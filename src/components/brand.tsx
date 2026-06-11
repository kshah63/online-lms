import { cn } from "@/lib/utils";

// MathVision brand colors (from the logo).
export const BRAND = {
  orange: "#F05A29",
  indigo: "#2D3092",
} as const;

/**
 * The MathVision mark — a layered downward chevron (indigo over orange),
 * derived from the "MV" logo. Transparent background, so it sits on any surface.
 */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 9 L24 28 L43 9" stroke={BRAND.indigo} strokeWidth={8} strokeLinejoin="miter" />
      <path d="M5 22 L24 41 L43 22" stroke={BRAND.orange} strokeWidth={8} strokeLinejoin="miter" />
    </svg>
  );
}

/** Mark + "MathVision" wordmark, for headers and the login screen. */
export function BrandWordmark({
  size = 30,
  className,
  textClassName,
}: {
  size?: number;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark size={size} />
      <span className={cn("font-semibold tracking-tight", textClassName)}>
        Math<span style={{ color: BRAND.orange }}>Vision</span>
      </span>
    </span>
  );
}
