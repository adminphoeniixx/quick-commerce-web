import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { queuesEnabled } from "@/lib/queue/connection";
import { importQueue, aggregationQueue, scheduledQueue } from "@/lib/queue/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Queue health indicators for the admin import monitor.
export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const orgId = resolveOrgId(session, new URL(req.url).searchParams.get("orgId"));
  await requirePermission(session, orgId, "integration:read");

  if (!queuesEnabled()) return ok({ enabled: false, mode: "inline", queues: {} });

  const [imp, agg, scheduled] = await Promise.all([
    importQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    aggregationQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    scheduledQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
  ]);
  return ok({ enabled: true, mode: "async", queues: { import: imp, aggregation: agg, scheduled }, collectedAt: new Date() });
});
