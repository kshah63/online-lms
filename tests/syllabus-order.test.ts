import { describe, expect, it } from "vitest";
import { applyUpsert, moveTopic, nextSortOrder, orderTopics } from "@/lib/bank/syllabus-order";
import type { SyllabusTopic } from "@/lib/bank/types";

const t = (id: string, sort_order: number, is_active = true): SyllabusTopic => ({ id, course_id: "c", label: id.toUpperCase(), parent_id: null, sort_order, course_topic_id: null, is_active });

describe("orderTopics / nextSortOrder", () => {
  it("puts active topics first in sort order and deactivated ones after", () => {
    expect(orderTopics([t("c", 30), t("x", 5, false), t("a", 10), t("b", 20)]).map((x) => x.id)).toEqual(["a", "b", "c", "x"]);
  });
  it("gives a new topic the slot after the last", () => {
    expect(nextSortOrder([t("a", 10), t("b", 20)])).toBe(30);
    expect(nextSortOrder([])).toBe(10);
  });
});

describe("moveTopic — a reorder is two upserts with the sort_orders swapped", () => {
  const list = [t("a", 10), t("b", 20), t("c", 30), t("z", 40, false)];

  it("swaps with the neighbour in the chosen direction", () => {
    expect(moveTopic(list, "b", "up")).toEqual([
      { id: "b", label: "B", parent_id: null, sort_order: 10, is_active: true },
      { id: "a", label: "A", parent_id: null, sort_order: 20, is_active: true },
    ]);
    expect(moveTopic(list, "b", "down").map((u) => [u.id, u.sort_order])).toEqual([["b", 30], ["c", 20]]);
  });

  it("does nothing at either end, skips deactivated topics, and ignores an unknown id", () => {
    expect(moveTopic(list, "a", "up")).toEqual([]);
    expect(moveTopic(list, "c", "down")).toEqual([]);
    expect(moveTopic(list, "z", "up")).toEqual([]);
    expect(moveTopic(list, "nope", "down")).toEqual([]);
  });

  it("still changes the order on screen when two topics share a slot", () => {
    const tied = [t("a", 10), t("b", 10), t("c", 20)];
    const up = moveTopic(tied, "b", "up");
    const after = orderTopics(up.reduce((acc, u) => applyUpsert(acc, "c", u, "new"), tied));
    expect(after.map((x) => x.id)).toEqual(["b", "a", "c"]);
    const down = moveTopic(tied, "a", "down");
    const after2 = orderTopics(down.reduce((acc, u) => applyUpsert(acc, "c", u, "new"), tied));
    expect(after2.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
});

describe("applyUpsert — the editor's state after upsert_syllabus_topic", () => {
  it("updates a known id in place and appends a new topic with the id the database gave", () => {
    const list = [t("a", 10)];
    expect(applyUpsert(list, "c", { id: "a", label: "Renamed", parent_id: null, sort_order: 10, is_active: false }, "new")[0]).toMatchObject({ id: "a", label: "Renamed", is_active: false });
    const added = applyUpsert(list, "c", { id: null, label: "New", parent_id: null, sort_order: 20, is_active: true }, "new-id");
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ id: "new-id", course_id: "c", label: "New", course_topic_id: null });
  });
});
