import { prisma } from "@/lib/db";
import { NotFound, BadRequest } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import type { Permission } from "@/lib/rbac/permissions";
import { browserSupported } from "./browser";

/** Loads a connection the caller may act on, and requires a browser-capable platform. */
export async function ownedBrowserConnection(req: Request, rawId: string, permission: Permission = "integration:update") {
  const session = await requireSession(req);
  let id: bigint;
  try { id = BigInt(rawId); } catch { throw NotFound("Connection not found"); }
  const connection = await prisma.platformConnection.findUnique({ where: { id }, include: { platform: true } });
  if (!connection) throw NotFound("Connection not found");
  await requirePermission(session, connection.orgId, permission);
  if (!browserSupported(connection.platform.slug)) throw BadRequest(`${connection.platform.name} browser connect is not available`);
  return { session, connection };
}
