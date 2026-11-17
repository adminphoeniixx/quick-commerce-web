"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdsShell, Kpi, type Metrics, inr, roasText, pctText, StatusPill, TYPE_LABEL, type AdsCtx } from "@/components/ads/AdsShell";
import { AdsTrend } from "@/components/ads/AdsTrend";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtN } from "@/lib/format";

interface Campaign { campaignId: string; name: string; type: string; status: string; period: Metrics; budget: number | null }
interface Keyword { keyword: string; matchType: string | null; impressions: number; spend: number; atc: number; sales: number; roas: number | null; cpm: number | null; position: number | null; campaigns: string[] }
interface Overview {
  empty?: boolean; range: { from: string; to: string }; kpis: Metrics;
  seller: { gmv: number; tacos: number | null; adSalesShare: number | null };
  trend: (Metrics & { date: string; sellerGmv: number })[];
  byType: (Metrics & { type: string; campaigns: number })[];
  topCampaigns: Campaign[]; topKeywords: Keyword[];
}

function OverviewView({ query, version }: AdsCtx) {
  const [d, setD] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setError(""); apiGet<Overview>(`/api/ads/overview?${query}`).then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load ads")); }, [query, version]);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!d) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (d.empty) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>No ad performance synced yet.</p>;
  const k = d.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Ad spend" value={inr(k.spend)} sub={k.cpm != null ? `CPM ${inr(k.cpm)}` : undefined} />
        <Kpi label="Ad-attributed sales" value={inr(k.sales)} sub={`direct ${inr(k.directSales)} · halo ${inr(k.indirectSales)}`} />
        <Kpi label="ROAS" value={roasText(k.roas)} sub={`direct ${roasText(k.directRoas)}`} />
        <Kpi label="Impressions" value={fmtN(k.impressions)} sub={k.ctr != null ? `CTR ${k.ctr.toFixed(2)}%` : undefined} />
        <Kpi label="Add to carts" value={fmtN(k.atc)} sub={`${inr(k.costPerAtc)} per ATC · ${pctText(k.atcRate, 2)} of impressions`} />
        <Kpi label="Units sold (ads)" value={fmtN(k.qty)} />
        <Kpi label="New users acquired" value={fmtN(k.newUsers)} />
        <Kpi label="TACoS" value={pctText(d.seller.tacos)} sub={d.seller.gmv ? `ad spend ÷ ${inr(d.seller.gmv)} Blinkit sales · ads drove ${pctText(d.seller.adSalesShare)}` : "needs Blinkit seller sales"} />
      </div>
      <AdsTrend data={d.trend} withSeller={d.seller.gmv > 0} subtitle="Daily spend (bars), ad-attributed sales and total Blinkit seller sales (lines)" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top campaigns" subtitle="By spend in the period" right={<Link href="/dashboard/ads/campaigns" className="text-xs font-semibold" style={{ color: "var(--accent)" }}>All campaigns →</Link>}>
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[12px]"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1.5 text-left font-medium">Campaign</th><th className="text-right font-medium">Spend</th><th className="text-right font-medium">Sales</th><th className="text-right font-medium">ROAS</th></tr></thead>
            <tbody>{d.topCampaigns.map((c) => <tr key={c.campaignId} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5 pr-2"><Link href={`/dashboard/ads/campaigns/${c.campaignId}`} className="hover:underline">{c.name}</Link><div className="mt-0.5 flex items-center gap-2 text-[10px]" style={{ color: "var(--muted)" }}><StatusPill status={c.status} />{TYPE_LABEL[c.type] ?? c.type}</div></td>
              <td className="tnum text-right">{inr(c.period.spend)}</td><td className="tnum text-right">{inr(c.period.sales)}</td><td className="tnum text-right font-semibold">{roasText(c.period.roas)}</td></tr>)}</tbody></table></div>
          {!d.topCampaigns.length && <p className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>No spend in this period.</p>}
        </Card>
        <Card title="Top keywords & placements" subtitle="By spend" right={<Link href="/dashboard/ads/keywords" className="text-xs font-semibold" style={{ color: "var(--accent)" }}>All keywords →</Link>}>
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[12px]"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1.5 text-left font-medium">Keyword</th><th className="text-right font-medium">Spend</th><th className="text-right font-medium">ATC</th><th className="text-right font-medium">Sales</th><th className="text-right font-medium">ROAS</th></tr></thead>
            <tbody>{d.topKeywords.map((x) => <tr key={x.keyword + x.matchType} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5 pr-2">{x.keyword}<div className="text-[10px]" style={{ color: "var(--muted)" }}>{x.matchType?.replace("_", " ").toLowerCase()}{x.position != null ? ` · avg slot ${x.position}` : ""}</div></td>
              <td className="tnum text-right">{inr(x.spend)}</td><td className="tnum text-right">{fmtN(x.atc)}</td><td className="tnum text-right">{inr(x.sales)}</td><td className="tnum text-right font-semibold">{roasText(x.roas)}</td></tr>)}</tbody></table></div>
          {!d.topKeywords.length && <p className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>No keyword data in this period (keyword reports cover the last 30 days).</p>}
        </Card>
      </div>
      <Card title="By ad type">
        <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[12px]"><thead><tr style={{ color: "var(--muted)" }}>{["Ad type", "Campaigns", "Spend", "Share", "Impressions", "ATC", "Sales", "ROAS"].map((h) => <th key={h} className={`py-1.5 font-medium ${h === "Ad type" ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
          <tbody>{d.byType.map((t) => <tr key={t.type} className="border-t" style={{ borderColor: "var(--border)" }}>
            <td className="py-1.5">{TYPE_LABEL[t.type] ?? t.type}</td><td className="tnum text-right">{t.campaigns}</td><td className="tnum text-right">{inr(t.spend)}</td>
            <td className="tnum text-right">{pctText(k.spend ? t.spend / k.spend : null)}</td><td className="tnum text-right">{fmtN(t.impressions)}</td><td className="tnum text-right">{fmtN(t.atc)}</td>
            <td className="tnum text-right">{inr(t.sales)}</td><td className="tnum text-right font-semibold">{roasText(t.roas)}</td></tr>)}</tbody></table></div>
      </Card>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>Figures come from your Blinkit Ads account ({d.range.from} – {d.range.to}, IST). Direct sales are the advertised products; halo (indirect) sales are other products of your brand bought after the ad. Blinkit refreshes yesterday&apos;s numbers during the day, so the latest day can change on the next sync.</p>
    </div>
  );
}

export default function AdsOverviewPage() {
  return <AdsShell title="Blinkit Ads" subtitle="Spend, attributed sales, ROAS, keywords and campaigns from your Blinkit Ads account.">{(ctx) => <OverviewView {...ctx} />}</AdsShell>;
}
