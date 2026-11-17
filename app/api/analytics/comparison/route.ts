import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { analyticsFilter } from "@/lib/analytics/params";
import { periodComparison } from "@/lib/analytics/queries";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export const GET=handler(async req=>{const session=await requireSession(req);const filter=await analyticsFilter(req,session);return ok({...await periodComparison(filter),filterCoverage:{platform:true,city:false,cityReason:filter.cityId?"AnalyticsDaily has no city grain; city is applied to category availability, pricing and visibility only.":null}})});
