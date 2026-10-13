import { describe, expect, it } from "vitest";
import { drawParams, evaluate, makeVariant, mulberry32, render } from "@/lib/practice/variants";

describe("evaluate", () => {
  it("respects precedence, unary minus, powers and functions", () => {
    expect(evaluate("2+3*4", {})).toBe(14);
    expect(evaluate("(2+3)*4", {})).toBe(20);
    expect(evaluate("-a^2", { a: 3 })).toBe(-9);
    expect(evaluate("2^3^2", {})).toBe(512);
    expect(evaluate("sqrt(a*a+b*b)", { a: 3, b: 4 })).toBe(5);
    expect(evaluate("round(a/b, 2)", { a: 1, b: 3 })).toBe(0.33);
    expect(evaluate("gcd(a,b)", { a: 12, b: 18 })).toBe(6);
  });
  it("refuses unknown names, bad syntax and non-finite results", () => {
    expect(() => evaluate("a+1", {})).toThrow();
    expect(() => evaluate("2+", {})).toThrow();
    expect(() => evaluate("1/0", {})).toThrow();
    expect(() => evaluate("alert(1)", {})).toThrow();
  });
});

describe("render", () => {
  it("fills parameters and computed fields", () => {
    expect(render("Solve {{a}}x + {{b}} = {{= a*c + b }}", { a: 2, b: 3, c: 5 })).toBe("Solve 2x + 3 = 13");
  });
  it("throws on a missing parameter", () => {
    expect(() => render("{{z}}", { a: 1 })).toThrow();
  });
});

describe("drawParams / makeVariant", () => {
  it("is deterministic for a seed and respects ranges and exclusions", () => {
    const specs = { a: { kind: "int" as const, min: 2, max: 9, exclude: [5] }, s: { kind: "choice" as const, values: ["+", "-"] } };
    const p1 = drawParams(specs, mulberry32(42));
    const p2 = drawParams(specs, mulberry32(42));
    expect(p1).toEqual(p2);
    for (let seed = 0; seed < 200; seed++) {
      const p = drawParams(specs, mulberry32(seed));
      expect(p.a).toBeGreaterThanOrEqual(2);
      expect(p.a).toBeLessThanOrEqual(9);
      expect(p.a).not.toBe(5);
      expect(["+", "-"]).toContain(p.s);
    }
  });
  it("computes the answer from the same parameters as the stem", () => {
    const v = makeVariant(
      {
        params: { a: { kind: "int", min: 1, max: 9 }, b: { kind: "int", min: 1, max: 9 } },
        stem: "What is {{a}} × {{b}}?",
        answer: "a*b",
        worked_solution: "{{a}} × {{b}} = {{= a*b }}",
      },
      7,
    );
    const a = Number(v.params.a);
    const b = Number(v.params.b);
    expect(v.stem).toBe(`What is ${a} × ${b}?`);
    expect(v.answer).toBe(a * b);
    expect(v.worked_solution).toBe(`${a} × ${b} = ${a * b}`);
  });
});
