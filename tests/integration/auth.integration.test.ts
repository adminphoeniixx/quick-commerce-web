import { describe, it, expect, afterAll } from "vitest";
import { HAS_DB } from "../setup";
import { prisma } from "@/lib/db";
import { issueRefreshToken, rotateRefreshToken } from "@/lib/auth/tokens";
import { requireMembership, requirePermission } from "@/lib/rbac/authorize";
import type { Session } from "@/lib/auth/session";

const createdUsers: bigint[] = [];
const createdOrgs: bigint[] = [];

async function makeUser(email: string) {
  const u = await prisma.user.create({ data: { email, passwordHash: "x" } });
  createdUsers.push(u.id);
  return u;
}
async function makeOrg(name: string) {
  const o = await prisma.organization.create({ data: { name } });
  createdOrgs.push(o.id);
  return o;
}
const sessionFor = (userId: bigint, activeOrgId: bigint | null): Session =>
  ({ userId, email: "t@t.com", isSuperAdmin: false, activeOrgId });

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.membership.deleteMany({ where: { orgId: { in: createdOrgs } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe.skipIf(!HAS_DB)("refresh-token rotation + reuse detection", () => {
  it("rotates once, then detects reuse and kills the family", async () => {
    const user = await makeUser(`rot_${Date.now()}@test.local`);
    const raw1 = await issueRefreshToken(user.id);

    const first = await rotateRefreshToken(raw1);
    expect(first.ok).toBe(true);
    const raw2 = first.ok ? first.token : "";

    // Replaying the consumed raw1 is a reuse → revoke all.
    const replay = await rotateRefreshToken(raw1);
    expect(replay).toEqual({ ok: false, reason: "reuse" });

    // raw2 was revoked by the family kill → no longer usable.
    const after = await rotateRefreshToken(raw2);
    expect(after.ok).toBe(false);

    const active = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it("rejects an unknown token", async () => {
    expect(await rotateRefreshToken("not-a-real-token")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe.skipIf(!HAS_DB)("cross-tenant isolation", () => {
  it("blocks access to an org the user does not belong to", async () => {
    const userA = await makeUser(`a_${Date.now()}@test.local`);
    const userB = await makeUser(`b_${Date.now()}@test.local`);
    const orgA = await makeOrg("Org A");
    const orgB = await makeOrg("Org B");
    await prisma.membership.create({ data: { userId: userA.id, orgId: orgA.id, role: "OWNER" } });
    await prisma.membership.create({ data: { userId: userB.id, orgId: orgB.id, role: "VIEWER" } });

    // A is not in B → forbidden.
    await expect(requireMembership(sessionFor(userA.id, orgB.id), orgB.id)).rejects.toThrow();
    // A owns A → allowed.
    await expect(requireMembership(sessionFor(userA.id, orgA.id), orgA.id)).resolves.toBeTruthy();
    // B is only a VIEWER in B → cannot create brands.
    await expect(
      requirePermission(sessionFor(userB.id, orgB.id), orgB.id, "brand:create"),
    ).rejects.toThrow();
    // B can read sales.
    await expect(
      requirePermission(sessionFor(userB.id, orgB.id), orgB.id, "sales:read"),
    ).resolves.toBeTruthy();
  });
});
