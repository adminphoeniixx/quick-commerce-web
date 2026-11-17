// Append-only audit trail. Never logs secrets — pass only non-sensitive meta.
import { prisma } from "@/lib/db";

export async function writeAudit(e: {
  action: string;
  userId?: bigint | null;
  orgId?: bigint | null;
  target?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: e.action,
        userId: e.userId ?? null,
        orgId: e.orgId ?? null,
        target: e.target ?? null,
        meta: (e.meta as object) ?? undefined,
        ip: e.ip ?? null,
      },
    });
  } catch {
    // Auditing must never break the request path.
  }
}
