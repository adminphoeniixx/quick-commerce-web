import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { ALL_PERMISSIONS, RESOURCES } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireSession(req);
  return ok({ resources: RESOURCES, permissions: ALL_PERMISSIONS });
});
