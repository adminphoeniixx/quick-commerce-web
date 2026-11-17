import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { ASSIGNABLE_ROLES, ROLE_PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Available org roles and the permissions each grants.
export const GET = handler(async (req) => {
  await requireSession(req);
  return ok({
    roles: ASSIGNABLE_ROLES.map((role) => ({ role, permissions: ROLE_PERMISSIONS[role] })),
  });
});
