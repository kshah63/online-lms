import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

/**
 * Tiny in-memory PostgREST look-alike for unit tests. Supports exactly the
 * query shapes the Pencil modules, the Space route and the admin actions use:
 * from().select / insert / upsert / update / delete, the eq / neq / in / is /
 * gte / gt / lte / lt filters, order / limit, maybeSingle / single, and
 * `await` (thenable) for list results and `{count, head}` selects. Extend it
 * here rather than reaching for a real database.
 */
export class FakeDb {
  tables: Record<string, Row[]> = {};

  from(table: string) {
    this.tables[table] ??= [];
    return new FakeQuery(this.tables[table]);
  }

  /** The service-role client type the Pencil modules take. */
  asAdmin(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

type Op = "select" | "insert" | "upsert" | "update" | "delete";

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private op: Op = "select";
  private payload: Row | Row[] | null = null;
  private onConflict: string[] = [];
  private count = false;
  private head = false;
  private orderBy: { key: string; ascending: boolean } | null = null;
  private max: number | null = null;

  constructor(private rows: Row[]) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.count = Boolean(opts?.count);
      this.head = Boolean(opts?.head);
    }
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = rows;
    this.onConflict = (opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return this;
  }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }

  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: unknown) { this.filters.push((r) => r[k] !== v); return this; }
  in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  is(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  gte(k: string, v: unknown) { this.filters.push((r) => compare(r[k], v) >= 0); return this; }
  gt(k: string, v: unknown) { this.filters.push((r) => compare(r[k], v) > 0); return this; }
  lte(k: string, v: unknown) { this.filters.push((r) => compare(r[k], v) <= 0); return this; }
  lt(k: string, v: unknown) { this.filters.push((r) => compare(r[k], v) < 0); return this; }
  order(k: string, opts?: { ascending?: boolean }) { this.orderBy = { key: k, ascending: opts?.ascending ?? true }; return this; }
  limit(n: number) { this.max = n; return this; }

  private exec(): Row[] {
    const match = (r: Row) => this.filters.every((f) => f(r));
    switch (this.op) {
      case "select": {
        let out = this.rows.filter(match);
        if (this.orderBy) {
          const { key, ascending } = this.orderBy;
          out = [...out].sort((a, b) => (ascending ? 1 : -1) * compare(a[key], b[key]));
        }
        if (this.max !== null) out = out.slice(0, this.max);
        return out;
      }
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const inserted = list.map((r) => ({ id: `row-${Math.random().toString(36).slice(2)}`, ...r }));
        this.rows.push(...inserted);
        return inserted;
      }
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        return list.map((incoming) => {
          const existing = this.rows.find(
            (r) => this.onConflict.length > 0 && this.onConflict.every((k) => r[k] === incoming[k]),
          );
          if (existing) {
            Object.assign(existing, incoming);
            return existing;
          }
          const row = { id: `row-${this.rows.length + 1}`, ...incoming };
          this.rows.push(row);
          return row;
        });
      }
      case "update": {
        const hit = this.rows.filter(match);
        for (const r of hit) Object.assign(r, this.payload as Row);
        return hit;
      }
      case "delete": {
        const hit = this.rows.filter(match);
        for (const r of hit) this.rows.splice(this.rows.indexOf(r), 1);
        return hit;
      }
    }
  }

  maybeSingle() {
    const rows = this.exec();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  single() {
    const rows = this.exec();
    return Promise.resolve(
      rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: `expected 1 row, got ${rows.length}` } },
    );
  }
  then<T>(resolve: (v: { data: Row[] | null; error: null; count: number | null }) => T) {
    const rows = this.exec();
    return Promise.resolve(resolve({ data: this.head ? null : rows, error: null, count: this.count ? rows.length : null }));
  }
}
