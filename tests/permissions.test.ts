import { describe, expect, it } from "vitest";
import { canSeeMaterialsAs, isFamily, isOffice } from "@/lib/permissions";
import { ROLES, type Role } from "@/lib/types";

describe("canSeeMaterialsAs — the one role-plus-seat mapping for the materials panel", () => {
  it("gives nobody a panel without a seat", () => {
    for (const role of ROLES) expect(canSeeMaterialsAs(role, null)).toBeNull();
  });

  it("maps admin to admin on any seat", () => {
    expect(canSeeMaterialsAs("admin", "observer")).toBe("admin");
    expect(canSeeMaterialsAs("admin", "host")).toBe("admin");
  });

  it("a staff member who teaches is a host, otherwise an in-charge", () => {
    expect(canSeeMaterialsAs("staff", "host")).toBe("teacher");
    expect(canSeeMaterialsAs("staff", "observer")).toBe("in_charge");
  });

  it("a teacher acts as teacher only when hosting; a student only when learning", () => {
    expect(canSeeMaterialsAs("teacher", "host")).toBe("teacher");
    expect(canSeeMaterialsAs("teacher", "observer")).toBeNull();
    expect(canSeeMaterialsAs("student", "learner")).toBe("student");
    expect(canSeeMaterialsAs("student", "host")).toBeNull();
  });

  it("support, parents and ambassadors never get a panel", () => {
    const none: Role[] = ["support", "parent", "ambassador"];
    for (const role of none) {
      expect(canSeeMaterialsAs(role, "observer")).toBeNull();
      expect(canSeeMaterialsAs(role, "learner")).toBeNull();
    }
  });
});

describe("isOffice / isFamily", () => {
  it("partition the roles that land on /admin and /home", () => {
    expect(ROLES.filter(isOffice)).toEqual(["staff", "support", "admin"]);
    expect(ROLES.filter(isFamily)).toEqual(["parent", "student"]);
    expect(isOffice("teacher")).toBe(false);
    expect(isFamily("ambassador")).toBe(false);
  });
});
