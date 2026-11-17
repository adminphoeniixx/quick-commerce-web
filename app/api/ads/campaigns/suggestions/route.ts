import { handler, ok } from "@/lib/http";
import { adsCampaigns, adsScope } from "@/lib/ads/queries";
import { adsRange } from "../../range";
import { suggestCampaigns } from "@/lib/ads/campaign-suggestions";
import { analyzeWithAgents } from "@/lib/ads/campaign-analysis-agents";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { requireSession } from "@/lib/auth/session";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const analysisCache = new Map<string, { expires: number; value: Promise<unknown> }>();

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const scope = await adsScope(req);
  const range = await adsRange(scope);
  if (!range) return ok({ suggestions: [], reason: "Sync Blinkit Ads performance to generate campaign suggestions." });
  const key = `${scope.brandId}:${range.from.toISOString()}:${range.to.toISOString()}`;
  let cached = analysisCache.get(key);
  if (!cached || cached.expires <= Date.now()) {
    await rateLimit(`ads-campaign-suggestions:${scope.orgId}`, 12, 3600);
    const value = (async () => {
      const rows = await adsCampaigns(scope, range);
      const daily = await prisma.adCampaignDaily.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId, date: { gte: range.from, lte: range.to } }, select: { campaignId: true, date: true, spend: true, totalSales: true, totalQty: true, impressions: true }, orderBy: { date: "asc" } });
      const byCampaign = new Map<string, { date: string; spend: number; sales: number; qty: number; impressions: number }[]>();
      for (const day of daily) { const list = byCampaign.get(day.campaignId) ?? []; list.push({ date: day.date.toISOString().slice(0, 10), spend: Number(day.spend), sales: Number(day.totalSales), qty: day.totalQty, impressions: day.impressions }); byCampaign.set(day.campaignId, list); }
      const drafts = suggestCampaigns(rows.map((row) => ({ ...row, daily: byCampaign.get(row.campaignId) ?? [] })));
      const analysis = await analyzeWithAgents(drafts);
      return { ...analysis, range: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) }, generatedAt: new Date().toISOString() };
    })();
    cached = { expires: Date.now() + 10 * 60_000, value }; analysisCache.set(key, cached);
    value.catch(() => analysisCache.delete(key));
  }
  const result = await cached.value as any;
  const suggestions = await Promise.all((result.suggestions ?? []).map(async (suggestion: any) => {
    const payload = JSON.stringify({ templateId: suggestion.templateId, name: suggestion.name, budget: suggestion.budget, start: suggestion.start, end: suggestion.end, evidence: suggestion.evidence, forecast: suggestion.projectedSales, consensus: suggestion.agentConsensus });
    const payloadHash = createHash("sha256").update(payload).digest("hex"), idempotencyKey = `campaign:${payloadHash}`;
    const proposal = await prisma.adCampaignProposal.upsert({ where: { orgId_idempotencyKey: { orgId: scope.orgId, idempotencyKey } }, create: {
      orgId: scope.orgId, brandId: scope.brandId, platformId: scope.platformId, templateCampaignId: suggestion.templateId, name: suggestion.name, budget: suggestion.budget,
      startAt: new Date(`${suggestion.start}T00:00:00Z`), endAt: new Date(`${suggestion.end}T00:00:00Z`), evidence: { launchReady: suggestion.launchReady, confidence: suggestion.confidence, historicalSpend: suggestion.historicalSpend, historicalSales: suggestion.historicalSales, historicalRoas: suggestion.historicalRoas, salesTools: suggestion.salesTools ?? null },
      forecast: { maximumSpend: suggestion.maximumSpend, projectedSales: suggestion.projectedSales, projectedRoas: suggestion.projectedRoas, assumptions: suggestion.assumptions, risks: suggestion.risks }, agentReviews: suggestion.agentConsensus ?? {},
      dataAsOf: new Date(`${result.range.to}T00:00:00Z`), model: result.model, promptVersion: "campaign-v2", idempotencyKey, payloadHash, createdBy: session.email,
    }, update: {} });
    return { ...suggestion, proposalId: proposal.id.toString(), proposalStatus: proposal.status };
  }));
  return ok({ ...result, suggestions });
});
