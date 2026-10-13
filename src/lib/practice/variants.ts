// ============================================================================
// "Same skill, new numbers" variants.
//
// A template question carries placeholders like {{a}} and computed fields like
// {{= a*b + 1 }}. Parameters are drawn from declared ranges; the answer is
// COMPUTED, never trusted from a model, so a generated variant can be
// verified before anyone sees it. The evaluator is a tiny recursive-descent
// parser — no eval(), no Function().
// ============================================================================

export type ParamSpec =
  | { kind: "int"; min: number; max: number; step?: number; exclude?: number[] }
  | { kind: "choice"; values: (number | string)[] };

export interface VariantTemplate {
  params: Record<string, ParamSpec>;
  /** Markdown with {{name}} and {{= expression }} placeholders. */
  stem: string;
  /** Expression for the numeric answer, e.g. "a*b+c". */
  answer: string;
  worked_solution?: string;
}

export type Params = Record<string, number | string>;

/** Deterministic PRNG so a seed reproduces the same variant (per-student tests). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawParams(specs: Record<string, ParamSpec>, rand: () => number): Params {
  const out: Params = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.kind === "choice") {
      out[name] = spec.values[Math.floor(rand() * spec.values.length)]!;
      continue;
    }
    const step = spec.step && spec.step > 0 ? spec.step : 1;
    const n = Math.floor((spec.max - spec.min) / step) + 1;
    const excluded = new Set(spec.exclude ?? []);
    let value = spec.min;
    for (let tries = 0; tries < 50; tries++) {
      value = spec.min + Math.floor(rand() * n) * step;
      if (!excluded.has(value)) break;
    }
    out[name] = value;
  }
  return out;
}

// --- expression evaluator -------------------------------------------------

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in expression`);
  }
  return toks;
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  gcd: (a, b) => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  },
};

/** Evaluate an arithmetic expression over numeric params. Throws on bad input. */
export function evaluate(expr: string, params: Params): number {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = () => toks[pos];
  const take = () => toks[pos++];

  function primary(): number {
    const tok = take();
    if (!tok) throw new Error("Unexpected end of expression");
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") {
      if (peek()?.t === "op" && peek()!.v === "(") {
        take();
        const args: number[] = [];
        if (!(peek()?.t === "op" && peek()!.v === ")")) {
          args.push(expression());
          while (peek()?.t === "op" && peek()!.v === ",") {
            take();
            args.push(expression());
          }
        }
        const close = take();
        if (!close || close.t !== "op" || close.v !== ")") throw new Error("Expected )");
        const fn = FUNCS[tok.v];
        if (!fn) throw new Error(`Unknown function ${tok.v}`);
        return fn(...args);
      }
      const v = params[tok.v];
      if (typeof v !== "number") throw new Error(`Unknown or non-numeric parameter ${tok.v}`);
      return v;
    }
    if (tok.v === "(") {
      const v = expression();
      const close = take();
      if (!close || close.t !== "op" || close.v !== ")") throw new Error("Expected )");
      return v;
    }
    if (tok.v === "-") return -unary();
    if (tok.v === "+") return unary();
    throw new Error(`Unexpected token ${tok.v}`);
  }
  function unary(): number {
    return power();
  }
  function power(): number {
    const base = primary();
    if (peek()?.t === "op" && peek()!.v === "^") {
      take();
      return Math.pow(base, unary()); // right-associative
    }
    return base;
  }
  function term(): number {
    let v = unary();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = take()!.v;
      const rhs = unary();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }
  function expression(): number {
    let v = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = take()!.v;
      const rhs = term();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = expression();
  if (pos !== toks.length) throw new Error("Unexpected trailing input");
  if (!Number.isFinite(result)) throw new Error("Expression did not produce a finite number");
  return result;
}

/** Fill {{name}} and {{= expr }} placeholders. Computed values are tidied to ≤ 6 dp. */
export function render(template: string, params: Params): string {
  return template.replace(/\{\{\s*(=?)\s*([^}]+?)\s*\}\}/g, (_m, eq: string, body: string) => {
    if (eq === "=") return tidy(evaluate(body, params));
    const v = params[body];
    if (v === undefined) throw new Error(`Missing parameter ${body}`);
    return typeof v === "number" ? tidy(v) : String(v);
  });
}

function tidy(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
}

export interface Variant {
  params: Params;
  stem: string;
  answer: number;
  worked_solution?: string;
}

/** Build one verified variant: the answer is computed from the same params as the stem. */
export function makeVariant(t: VariantTemplate, seed: number): Variant {
  const params = drawParams(t.params, mulberry32(seed));
  const answer = evaluate(t.answer, params);
  return {
    params,
    stem: render(t.stem, params),
    answer: Math.round(answer * 1e6) / 1e6,
    worked_solution: t.worked_solution ? render(t.worked_solution, params) : undefined,
  };
}
