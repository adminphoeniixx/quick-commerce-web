// RBAC catalog — resources × actions, and the role → permission mapping.
// Enforced at the API layer (see lib/rbac/authorize.ts). Pure logic, unit-tested.

import type { MembershipRole } from "@prisma/client";

export const RESOURCES = [
  "organization", "member", "brand", "product", "sales", "inventory",
  "pricing", "integration", "report", "alert", "billing", "audit",
] as const;
export type Resource = (typeof RESOURCES)[number];

export type Action = "read" | "create" | "update" | "delete" | "manage";

export type Permission = `${Resource}:${Action}`;

// Full catalog of permissions that exist in the system.
export const ALL_PERMISSIONS: Permission[] = RESOURCES.flatMap((r) =>
  (["read", "create", "update", "delete", "manage"] as Action[]).map(
    (a) => `${r}:${a}` as Permission,
  ),
);

// Helpers to build sets concisely.
const all = (r: Resource): Permission[] =>
  (["read", "create", "update", "delete", "manage"] as Action[]).map((a) => `${r}:${a}` as Permission);
const read = (r: Resource): Permission => `${r}:read`;

// Everything an org can do (OWNER baseline).
const ORG_FULL: Permission[] = [
  ...all("organization"), ...all("member"), ...all("brand"), ...all("product"),
  ...all("sales"), ...all("inventory"), ...all("pricing"), ...all("integration"),
  ...all("report"), ...all("alert"), ...all("billing"), ...all("audit"),
];

// Admin: operational + team, but NOT billing:manage, org:delete, org:manage (transfer/ownership).
const ADMIN: Permission[] = ORG_FULL.filter(
  (p) => !["billing:manage", "billing:create", "billing:update", "billing:delete",
           "organization:delete", "organization:manage"].includes(p),
);

// Analyst: read everything operational + create/update reports & alerts.
const ANALYST: Permission[] = [
  read("organization"), read("member"), read("brand"), read("product"),
  read("sales"), read("inventory"), read("pricing"), read("integration"),
  read("report"), "report:create", "report:update",
  read("alert"), "alert:create", "alert:update",
  read("audit"),
];

// Viewer: read-only across operational resources (no billing, no audit).
const VIEWER: Permission[] = [
  read("organization"), read("member"), read("brand"), read("product"),
  read("sales"), read("inventory"), read("pricing"), read("integration"),
  read("report"), read("alert"),
];

export const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  OWNER: ORG_FULL,
  ORG_ADMIN: ADMIN,
  ANALYST,
  VIEWER,
};

/** Does an org role grant a permission? */
export function roleHasPermission(role: MembershipRole, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role];
  if (!granted) return false;
  if (granted.includes(permission)) return true;
  // `manage` implies all actions on that resource.
  const resource = permission.split(":")[0] as Resource;
  return granted.includes(`${resource}:manage` as Permission);
}

export const ASSIGNABLE_ROLES: MembershipRole[] = ["OWNER", "ORG_ADMIN", "ANALYST", "VIEWER"];
