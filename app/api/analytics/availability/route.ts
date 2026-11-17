import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { analyticsFilter } from "@/lib/analytics/params";
import { availabilityByCity, oosTrend } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const filter = await analyticsFilter(req, session);
  const [byCity, oos] = await Promise.all([availabilityByCity(filter), oosTrend(filter)]);
  return ok({ byCity, oosTrend: oos });
});
