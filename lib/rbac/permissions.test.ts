import { describe, it, expect } from "vitest";
import { roleHasPermission, ROLE_PERMISSIONS, ALL_PERMISSIONS } from "./permissions";

describe("RBAC permissions", () => {
  it("OWNER can manage billing and delete the organization", () => {
    expect(roleHasPermission("OWNER", "billing:manage")).toBe(true);
    expect(roleHasPermission("OWNER", "organization:delete")).toBe(true);
  });

  it("ORG_ADMIN cannot manage billing or delete the organization", () => {
    expect(roleHasPermission("ORG_ADMIN", "billing:manage")).toBe(false);
    expect(roleHasPermission("ORG_ADMIN", "organization:delete")).toBe(false);
    expect(roleHasPermission("ORG_ADMIN", "member:create")).toBe(true);
  });

  it("ANALYST can read sales and create reports but not invite members", () => {
    expect(roleHasPermission("ANALYST", "sales:read")).toBe(true);
    expect(roleHasPermission("ANALYST", "report:create")).toBe(true);
    expect(roleHasPermission("ANALYST", "member:create")).toBe(false);
  });

  it("VIEWER is read-only and cannot write anything", () => {
    expect(roleHasPermission("VIEWER", "sales:read")).toBe(true);
    expect(roleHasPermission("VIEWER", "brand:create")).toBe(false);
    expect(roleHasPermission("VIEWER", "report:create")).toBe(false);
    expect(roleHasPermission("VIEWER", "audit:read")).toBe(false);
  });

  it("manage implies the other actions on the same resource", () => {
    // OWNER has brand:manage → implies brand:update
    expect(roleHasPermission("OWNER", "brand:update")).toBe(true);
  });

  it("every role's permissions are a subset of the full catalog", () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const p of perms) expect(ALL_PERMISSIONS).toContain(p);
    }
  });
});
