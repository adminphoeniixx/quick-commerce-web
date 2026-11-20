// Refresh-token lifecycle: issue, rotate (one-time use), reuse detection, revoke.
// Only SHA-256 hashes are stored; the raw token is returned to the caller once.
import { prisma } from "@/lib/db";
import { generateRefreshToken, hashToken, REFRESH_TTL } from "./jwt";
import { writeAudit } from "@/lib/audit";

export async function issueRefreshToken(userId: bigint): Promise<string> {
  const { token, hash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash, expiresAt: new Date(Date.now() + REFRESH_TTL * 1000) },
  });
  return token;
}

export type RotateResult =
  | { ok: true; userId: bigint; token: string }
  | { ok: false; reason: "invalid" | "expired" | "reuse" };

/** Seconds after a ROTATION during which the old token may be presented again (0 = strict). */
export const reuseGraceSeconds = () => Math.max(0, Number(process.env.REFRESH_REUSE_GRACE_SECONDS ?? 30));
// Each grace rotation extends the chain by one, so a burst of parallel refreshes needs more than a few hops.
const MAX_CHAIN_HOPS = 20;

/**
 * Atomically consume `id` and issue its successor. The successor is created first and linked in
 * the same conditional update that revokes `id`, so revokedAt and rotatedTo always appear together.
 * Returns null when another request consumed `id` first.
 */
async function claimAndRotate(id: bigint, userId: bigint): Promise<string | null> {
  const { token, hash } = generateRefreshToken();
  const created = await prisma.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt: new Date(Date.now() + REFRESH_TTL * 1000) } });
  const claimed = await prisma.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), rotatedTo: created.id } });
  if (claimed.count === 1) return token;
  await prisma.refreshToken.delete({ where: { id: created.id } }).catch(() => undefined);
  return null;
}

/** Newest token of a rotation chain, following rotatedTo for at most MAX_CHAIN_HOPS. */
async function chainHead(startId: bigint) {
  let current = await prisma.refreshToken.findUnique({ where: { id: startId } });
  for (let hop = 0; current?.rotatedTo != null && hop < MAX_CHAIN_HOPS; hop++) current = await prisma.refreshToken.findUnique({ where: { id: current.rotatedTo } });
  return current?.rotatedTo == null ? current : null;
}

async function reuseDetected(userId: bigint): Promise<RotateResult> {
  // Replay of a consumed token → compromise. Kill all sessions for this user.
  await revokeAllForUser(userId);
  await writeAudit({ userId, action: "auth.refresh.reuse_detected" });
  return { ok: false, reason: "reuse" };
}

/**
 * Rotate a refresh token: the presented token is consumed and a new one issued.
 * Reuse detection: presenting an already-revoked token revokes the whole family
 * (all of that user's active tokens) and refuses the request — except within a short
 * grace window after a legitimate ROTATION, when the response carrying the new cookie
 * may have been lost (navigation aborted the request) or parallel tabs refreshed at once.
 * Then the chain's newest token is rotated instead. Logout / revoke-all never get grace.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  const hash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!existing) return { ok: false, reason: "invalid" };

  if (!existing.revokedAt) {
    if (existing.expiresAt.getTime() < Date.now()) {
      await prisma.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return { ok: false, reason: "expired" };
    }
    const token = await claimAndRotate(existing.id, existing.userId);
    if (token) return { ok: true, userId: existing.userId, token };
    // Lost the race to a parallel refresh: fall through to the grace path with the fresh row.
  }

  for (let attempt = 0; attempt < MAX_CHAIN_HOPS; attempt++) {
    const row = await prisma.refreshToken.findUnique({ where: { id: existing.id } });
    const grace = reuseGraceSeconds() * 1000;
    if (!row?.revokedAt || row.rotatedTo == null || grace === 0 || Date.now() - row.revokedAt.getTime() > grace) return reuseDetected(existing.userId);
    const head = await chainHead(row.rotatedTo);
    if (!head || head.revokedAt || head.expiresAt.getTime() < Date.now()) return reuseDetected(existing.userId);
    const token = await claimAndRotate(head.id, existing.userId);
    if (token) {
      await writeAudit({ userId: existing.userId, action: "auth.refresh.grace_reuse", meta: { tokenId: existing.id.toString() } });
      return { ok: true, userId: existing.userId, token };
    }
    // Another request rotated the head meanwhile; follow the chain again.
  }
  return reuseDetected(existing.userId);
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: bigint): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function listActiveSessions(userId: bigint) {
  return prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}
