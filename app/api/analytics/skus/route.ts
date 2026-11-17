import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { analyticsFilter } from "@/lib/analytics/params";
import { skuPerformance } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const filter = await analyticsFilter(req, session);
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 50)));
  return ok({ skus: await skuPerformance(filter, limit) });
});
