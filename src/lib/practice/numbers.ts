// ============================================================================
// Parsing and comparing the numbers students type.
//
// Students write "3/4", "0.75", "−0.75", "1,250", "2.5 cm", "7 1/2", "3e4".
// All of those must compare correctly against the answer key without a
// teacher having to anticipate every spelling.
// ============================================================================

const UNICODE_MINUS = /[−–—]/g; // − – —
const THIN_SPACES = /[   ]/g;

/** Strip units and decoration, keep digits, signs, separators, fraction bars, exponents. */
export function normaliseNumericText(raw: string): string {
  return raw
    .replace(UNICODE_MINUS, "-")
    .replace(THIN_SPACES, " ")
    .replace(/[%$£€]/g, "")
    .trim()
    .replace(/^[a-zA-Z=\s:]+/, "") // "x = 5", "ans: 5"
    .replace(/\s*(cm|mm|m|km|kg|g|ml|l|s|h|min|deg|°|units?)\.?\s*$/i, "")
    .replace(/,(?=\d{3}\b)/g, "") // thousands separators
    .trim();
}

/**
 * Parse a typed number. Supports decimals, fractions (a/b), mixed numbers
 * (w a/b), scientific notation and a leading sign. Returns null when it is not
 * a number.
 */
export function parseNumber(raw: string): number | null {
  const text = normaliseNumericText(raw);
  if (!text) return null;

  // Mixed number: "7 1/2" or "-2 3/4"
  const mixed = text.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const sign = mixed[1] === "-" ? -1 : 1;
    const whole = Number(mixed[2]);
    const num = Number(mixed[3]);
    const den = Number(mixed[4]);
    if (den === 0) return null;
    return sign * (whole + num / den);
  }

  // Fraction: "3/4", "-3/4", "3 / 4"
  const frac = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }

  // Plain decimal / scientific
  if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Number of decimal places in the canonical decimal form of a number. */
export function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = n.toString();
  if (s.includes("e-")) {
    const [mant, exp] = s.split("e-");
    return (mant.split(".")[1]?.length ?? 0) + Number(exp);
  }
  return s.split(".")[1]?.length ?? 0;
}

/**
 * Default absolute tolerance for an answer key: half a unit in its last
 * decimal place, so an answer stored as 2.35 accepts 2.345…2.355 and an
 * integer answer accepts only ±0.5 of itself (which still rejects 6 for 5).
 * A tiny floor avoids float noise on exact answers.
 */
export function defaultTolerance(answer: number): number {
  const places = decimalPlaces(answer);
  return Math.max(0.5 * Math.pow(10, -places), 1e-9);
}

export function numbersMatch(
  given: number,
  answer: number,
  opts: { tolerance?: number | null; tolerance_pct?: number | null } = {},
): boolean {
  if (opts.tolerance_pct != null && opts.tolerance_pct > 0) {
    return Math.abs(given - answer) <= Math.abs(answer) * (opts.tolerance_pct / 100) + 1e-12;
  }
  const tol = opts.tolerance != null && opts.tolerance >= 0 ? opts.tolerance : defaultTolerance(answer);
  // Integers are strict: "half a unit" would otherwise accept 5.4 for 5.
  if (opts.tolerance == null && Number.isInteger(answer)) return Math.abs(given - answer) < 1e-9;
  return Math.abs(given - answer) <= tol + 1e-12;
}
