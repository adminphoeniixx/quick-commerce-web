// Sales analysis from the stored order lines: KPIs, daily trend and breakdowns.
import { handler, ok } from "@/lib/http";
import { sellerScope, dateRange, dataSpan, salesSummary } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await sellerScope(req, "sales:read");
  let range = dateRange(scope.url);
  if (!range) {
    const span = await dataSpan(scope);
    if (!span.from || !span.to) return ok({ empty: true });
    range = { from: new Date(span.from), to: new Date(span.to) };
  }
  return ok(await salesSummary(scope, range));
});
