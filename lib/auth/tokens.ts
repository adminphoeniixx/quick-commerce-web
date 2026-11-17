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

/**
 * Rotate a refresh token: the presented token is consumed and a new one issued.
 * Reuse detection: presenting an already-revoked token revokes the whole family
 * (all of that user's active tokens) and refuses the request.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  const hash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!existing) return { ok: false, reason: "invalid" };

  if (existing.revokedAt) {
    // Replay of a consumed token → compromise. Kill all sessions for this user.
    await revokeAllForUser(existing.userId);
    await writeAudit({ userId: existing.userId, action: "auth.refresh.reuse_detected" });
    return { ok: false, reason: "reuse" };
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    return { ok: false, reason: "expired" };
  }

  const { token, hash: newHash } = generateRefreshToken();
  const created = await prisma.refreshToken.create({
    data: {
      userId: existing.userId,
      tokenHash: newHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
    },
  });
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), rotatedTo: created.id },
  });
  return { ok: true, userId: existing.userId, token };
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
