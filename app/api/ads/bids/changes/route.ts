// Blinkit Ads bid changes: GET history, POST new proposals (PENDING until approved).
import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/http";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { rateLimit } from "@/lib/ratelimit";
import { adsScope } from "@/lib/ads/queries";
import { bidHistory, proposeBids, BID_MAX, BID_MIN, MAX_CHANGES_PER_REQUEST } from "@/lib/ads/bids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await adsScope(req);
  return ok({ changes: await bidHistory(scope) });
});

const schema = z.object({
  changes: z.array(z.object({
    campaignId: z.string().regex(/^\d+$/).max(20),
    keyword: z.string().trim().min(1).max(200),
    matchType: z.enum(["EXACT", "SMART"]),
    toCpm: z.number().int().min(BID_MIN).max(BID_MAX),
    note: z.string().max(300).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    dataAsOf: z.string().date().optional(),
    model: z.string().max(100).nullable().optional(),
    promptVersion: z.string().max(50).optional(),
  })).min(1).max(MAX_CHANGES_PER_REQUEST),
});

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:update");
  await rateLimit(`ads-bids-propose:${scope.orgId}`, 60, 3600);
  const body = await parseBody(req, schema);
  return ok(await proposeBids(scope, session.email, session.userId, body.changes));
});
