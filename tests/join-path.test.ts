import { describe, expect, it } from "vitest";
import { parseTicketFragment, safeRelativePath } from "@/lib/join/path";

describe("safeRelativePath — where a redeemed ticket may land", () => {
  it("accepts a same-site path", () => {
    expect(safeRelativePath("/lesson/20000000-0000-0000-0000-000000000002")).toBe("/lesson/20000000-0000-0000-0000-000000000002");
    expect(safeRelativePath("/home/progress/abc?course=1#top")).toBe("/home/progress/abc?course=1#top");
    expect(safeRelativePath("  /test/42 ")).toBe("/test/42");
  });

  it("refuses anything that could leave the site", () => {
    expect(safeRelativePath("https://evil.example/lesson")).toBeNull();
    expect(safeRelativePath("//evil.example/lesson")).toBeNull();
    expect(safeRelativePath("/\\evil.example")).toBeNull();
    expect(safeRelativePath("/javascript:alert(1)")).toBeNull();
    expect(safeRelativePath("lesson/1")).toBeNull();
    expect(safeRelativePath("/lesson/1\nSet-Cookie: x")).toBeNull();
  });

  it("refuses non-strings and empty values", () => {
    expect(safeRelativePath(undefined)).toBeNull();
    expect(safeRelativePath(null)).toBeNull();
    expect(safeRelativePath(42)).toBeNull();
    expect(safeRelativePath("")).toBeNull();
  });
});

describe("parseTicketFragment — #t=<token>&next=<path>", () => {
  it("reads the token and a safe next path", () => {
    expect(parseTicketFragment("#t=abc123&next=%2Flesson%2F42")).toEqual({ token: "abc123", next: "/lesson/42" });
    expect(parseTicketFragment("t=abc123&next=/lesson/42")).toEqual({ token: "abc123", next: "/lesson/42" });
  });

  it("drops an unsafe next and a missing token", () => {
    expect(parseTicketFragment("#t=abc&next=https://evil.example")).toEqual({ token: "abc", next: null });
    expect(parseTicketFragment("#next=/lesson/1")).toEqual({ token: null, next: "/lesson/1" });
    expect(parseTicketFragment("")).toEqual({ token: null, next: null });
  });
});
