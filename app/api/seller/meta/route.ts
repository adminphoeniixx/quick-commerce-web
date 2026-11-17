// Data span + connection state for the seller pages (default date range, sync buttons).
import { handler, ok } from "@/lib/http";
import { sellerScope, dataSpan } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => ok(await dataSpan(await sellerScope(req, "sales:read"))));
