export interface DailyEvidence { date: string; spend: number; sales: number; qty: number; impressions: number }
export interface SuggestionSource {
  campaignId: string; name: string; type: string; status: string; budget: number | null; endAt: Date | string | null; productIds: string[];
  period: { spend: number; sales: number; roas: number | null; impressions: number }; daily?: DailyEvidence[];
}
export interface AgentReview { role: string; verdict: "launch" | "review" | "skip"; summary: string; drivers: string[]; risks: string[] }
export interface SalesToolEvidence { sellerGmv: number; sellerUnits: number; tacos: number | null; attributedUnits: number; newUsers: number; atc: number; directSales: number; indirectSales: number; products: { productId: string; name: string | null; sellerUnits: number; sellerGmv: number }[]; topKeywords: { keyword: string; spend: number; sales: number; roas: number | null }[] }
export interface CampaignSuggestion {
  id: string; templateId: string; templateName: string; name: string; type: string; reason: string; evidence: string;
  budget: number; start: string; end: string; productCount: number; expectedStatus: string; expectedBudget: number | null;
  observedDays: number; spendDays: number; historicalSpend: number; historicalSales: number; historicalRoas: number | null;
  maximumSpend: number; projectedSales: { low: number; base: number; high: number }; projectedRoas: { low: number; base: number; high: number };
  confidence: "low" | "medium" | "high"; launchReady: boolean; benefitExplanation: string; assumptions: string[]; risks: string[];
  agentConsensus?: { verdict: "launch" | "review" | "skip"; summary: string; reviews: AgentReview[] };
  salesTools?: SalesToolEvidence;
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const quantile = (values: number[], q: number) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b), p = (s.length - 1) * q, l = Math.floor(p), h = Math.ceil(p); return s[l] + (s[h] - s[l]) * (p - l); };

/** Numeric scenarios are deterministic. Agent narratives may explain, never alter, these bounds. */
export function suggestCampaigns(rows: SuggestionSource[], now = new Date()): CampaignSuggestion[] {
  const startDate = new Date(now); startDate.setUTCDate(startDate.getUTCDate() + 1); const endDate = new Date(startDate); endDate.setUTCDate(endDate.getUTCDate() + 13);
  const start = iso(startDate), end = iso(endDate), existingNames = new Set(rows.map((row) => row.name.toLowerCase()));
  return rows.filter((row) => row.budget && row.budget > 0 && row.productIds.length > 0 && !row.name.startsWith("QCP ·")).map((row) => {
    const daily = row.daily ?? [], spendDays = daily.filter((day) => day.spend > 0), dailyRoas = spendDays.map((day) => day.sales / day.spend).filter(Number.isFinite);
    const observedRoas = row.period.roas ?? 0, p25 = quantile(dailyRoas, .25), p50 = quantile(dailyRoas, .5), p75 = quantile(dailyRoas, .75);
    const stopped = ["STOPPED", "COMPLETED"].includes(row.status), kind = stopped && row.period.sales > 0 ? "relaunch" : observedRoas >= 2 ? "scale" : "test";
    const suffix = kind === "relaunch" ? "Relaunch" : kind === "scale" ? "Scale" : "Test", name = `QCP · ${suffix} · ${row.name} · ${start}`.slice(0, 160);
    const budget = kind === "scale" ? Math.round(row.budget! * 1.10) : Math.round(row.budget!), maximumSpend = budget * 14;
    const hasDailyRates = dailyRoas.length > 0;
    const lowRate = Math.max(0, Math.min(hasDailyRates ? p25 : observedRoas * .5, observedRoas * .6)), baseRate = Math.max(0, Math.min(hasDailyRates ? p50 : observedRoas * .7, observedRoas * .8)), highRate = Math.max(0, Math.min(hasDailyRates ? p75 : observedRoas, observedRoas));
    const projectedRoas = { low: lowRate, base: baseRate, high: highRate }, projectedSales = { low: maximumSpend * lowRate, base: maximumSpend * baseRate, high: maximumSpend * highRate };
    const dates = [...new Set(daily.map((day) => day.date))], latest = dates.length ? dates[dates.length - 1] : null;
    const fresh = latest ? (now.getTime() - new Date(`${latest}T23:59:59Z`).getTime()) <= 3 * 86400_000 : false;
    const enough = dates.length >= 21 && spendDays.length >= 14 && row.period.spend >= Math.max(2000, row.budget! * 3) && fresh;
    const confidence: CampaignSuggestion["confidence"] = enough && dailyRoas.length >= 20 ? "high" : spendDays.length >= 7 && fresh ? "medium" : "low";
    // Active-template duplication can overlap auctions and double spend. Only evidence-backed stopped campaigns may launch through this duplicate flow.
    const launchReady = stopped && enough && p25 >= 1 && observedRoas > 0;
    const reason = kind === "relaunch" ? "Past attributed sales support a controlled 14-day relaunch test." : kind === "scale" ? "Strong historical ROAS supports a controlled copy with only 10% higher daily budget." : "This template can collect a controlled 14-day baseline; evidence is not strong enough for scaling.";
    const risks = ["Historical attribution does not prove incremental sales.", "Actual spend and ROAS can be lower than this scenario.", ...(!fresh ? ["Latest campaign evidence is older than 3 days."] : []), ...(kind === "scale" ? ["Active-template duplication is blocked because it can overlap auctions and increase spend."] : [])];
    const assumptions = ["Historical efficiency partially persists for 14 days.", "Products remain in stock and eligible.", "No major price, seasonality, targeting or auction change."];
    return { id: `${row.campaignId}:${kind}:${start}`, templateId: row.campaignId, templateName: row.name, name, type: row.type, reason,
      evidence: row.period.spend > 0 ? `${money(row.period.spend)} spend · ${money(row.period.sales)} attributed sales · ${observedRoas ? `${observedRoas.toFixed(2)}x ROAS` : "ROAS unavailable"}` : `${row.productIds.length} products · no spend in selected period`,
      budget, start, end, productCount: row.productIds.length, expectedStatus: row.status, expectedBudget: row.budget, observedDays: daily.length, spendDays: spendDays.length,
      historicalSpend: row.period.spend, historicalSales: row.period.sales, historicalRoas: row.period.roas, maximumSpend, projectedSales, projectedRoas, confidence, launchReady,
      benefitExplanation: `If historical efficiency partially persists, ${money(projectedSales.low)}–${money(projectedSales.high)} attributed sales may be observed against up to ${money(maximumSpend)} spend. This is a scenario, not guaranteed incremental revenue.`, assumptions, risks };
  }).filter((row) => !existingNames.has(row.name.toLowerCase())).sort((a, b) => b.projectedRoas.base - a.projectedRoas.base || b.historicalSales - a.historicalSales).slice(0, 3);
}
