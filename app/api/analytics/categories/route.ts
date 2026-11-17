import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { analyticsFilter } from "@/lib/analytics/params";
import { categoryAnalytics } from "@/lib/analytics/queries";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export const GET=handler(async req=>{const session=await requireSession(req);const filter=await analyticsFilter(req,session);return ok({categories:await categoryAnalytics(filter),filters:{category:filter.category??null,cityId:filter.cityId??null}})});
