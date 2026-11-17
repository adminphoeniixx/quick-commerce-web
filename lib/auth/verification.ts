// One-time tokens for email verification and password reset (hash-at-rest).
import { prisma } from "@/lib/db";
import type { VerificationType } from "@prisma/client";
import { generateRefreshToken, hashToken } from "./jwt";

export async function createVerificationToken(
  userId: bigint,
  type: VerificationType,
  ttlSec: number,
): Promise<string> {
  const { token, hash } = generateRefreshToken();
  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: hash, expiresAt: new Date(Date.now() + ttlSec * 1000) },
  });
  return token;
}

export async function consumeVerificationToken(
  rawToken: string,
  type: VerificationType,
): Promise<bigint | null> {
  const hash = hashToken(rawToken);
  const row = await prisma.verificationToken.findUnique({ where: { tokenHash: hash } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  await prisma.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}
