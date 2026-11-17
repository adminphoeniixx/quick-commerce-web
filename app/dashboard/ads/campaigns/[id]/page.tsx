"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AdsShell, type Metrics, Kpi, inr, roasText, pctText, StatusPill, TYPE_LABEL, type AdsCtx } from "@/components/ads/AdsShell";
import { AdsTrend } from "@/components/ads/AdsTrend";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtN } from "@/lib/format";
import { CampaignActions } from "@/components/ads/CampaignActions";

interface Detail {
  range: { from: string; to: string };
  campaign: { campaignId: string; name: string; type: string; objective: string | null; status: string; startAt: string | null; endAt: string | null; budget: number | null; pacing: string | null; regionType: string | null; cities: string[];
    targetedKeywords: { keyword: string; bids: { match_type?: string; cpm?: number }[] }[]; lifetime: { spend: number | null; impressions: number | null; sales: number | null; atc: number | null } };
  kpis: Metrics; trend: (Metrics & { date: string })[];
  keywords: { keyword: string; matchType: string | null; impressions: number; spend: number; atc: number; sales: number; qty: number; roas: number | null; cpm: number | null; position: number | null; newUsers: number }[];
  products: { productId: string; itemId: string | null; name: string | null; mrp: number | null; sellingPrice: number | null; sellerUnits: number; sellerGmv: number }[];
  seller: { gmv: number; units: number; tacos: number | null };
}

function CampaignView({ query, version }: AdsCtx) {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiGet<Detail>(`/api/ads/campaigns/${id}?${query}`).then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load campaign")); }, [id, query, version]);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!d) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  const c = d.campaign, k = d.kpis;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Link href="/dashboard/ads/campaigns" className="text-xs font-semibold" style={{ color: "var(--accent)" }}>← Campaigns</Link>
        <h2 className="text-lg font-bold">{c.name}</h2><StatusPill status={c.status} /><span className="mr-auto text-xs" style={{ color: "var(--muted)" }}>{TYPE_LABEL[c.type] ?? c.type} · {c.objective?.toLowerCase()} · #{c.campaignId}</span><CampaignActions campaign={c} query={query} /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Spend" value={inr(k.spend)} sub={`CPM ${inr(k.cpm)}`} />
        <Kpi label="Sales" value={inr(k.sales)} sub={`direct ${inr(k.directSales)}`} />
        <Kpi label="ROAS" value={roasText(k.roas)} />
        <Kpi label="Impressions" value={fmtN(k.impressions)} />
        <Kpi label="ATC" value={fmtN(k.atc)} sub={`${inr(k.costPerAtc)} per ATC`} />
        <Kpi label="Units sold" value={fmtN(k.qty)} />
        <Kpi label="New users" value={fmtN(k.newUsers)} />
        <Kpi label="TACoS on these products" value={pctText(d.seller.tacos)} sub={`${inr(d.seller.gmv)} Blinkit sales of advertised products`} />
      </div>
      <AdsTrend data={d.trend} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Keyword & placement performance" subtitle="Search keywords, or recommendation placements; reports synced for the last 30 days">
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12px]"><thead><tr style={{ color: "var(--muted)" }}>{["Keyword", "Impr.", "Spend", "CPM", "ATC", "Sales", "ROAS", "Avg slot"].map((h) => <th key={h} className={`py-1.5 font-medium ${h === "Keyword" ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
            <tbody>{d.keywords.map((x) => <tr key={x.keyword + x.matchType} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5">{x.keyword} <span className="text-[10px]" style={{ color: "var(--muted)" }}>{x.matchType?.replace("_", " ").toLowerCase()}</span></td>
              <td className="tnum text-right">{fmtN(x.impressions)}</td><td className="tnum text-right">{inr(x.spend)}</td><td className="tnum text-right">{inr(x.cpm)}</td><td className="tnum text-right">{fmtN(x.atc)}</td>
              <td className="tnum text-right">{inr(x.sales)}</td><td className="tnum text-right font-semibold">{roasText(x.roas)}</td><td className="tnum text-right">{x.position ?? "—"}</td></tr>)}</tbody></table></div>
          {!d.keywords.length && <p className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>No keyword data for this period.</p>}
        </Card>
        <div className="space-y-4">
          <Card title="Settings">
            <dl className="grid grid-cols-2 gap-y-2 text-[12px]">
              <dt style={{ color: "var(--muted)" }}>Runs</dt><dd className="tnum">{c.startAt?.slice(0, 10) ?? "—"} → {c.endAt?.slice(0, 10) ?? "no end date"}</dd>
              <dt style={{ color: "var(--muted)" }}>Budget</dt><dd className="tnum">{inr(c.budget)} {c.pacing?.toLowerCase()}</dd>
              <dt style={{ color: "var(--muted)" }}>Lifetime spend</dt><dd className="tnum">{inr(c.lifetime.spend)}</dd>
              <dt style={{ color: "var(--muted)" }}>Lifetime sales</dt><dd className="tnum">{inr(c.lifetime.sales)}{c.lifetime.spend ? ` · ROAS ${roasText((c.lifetime.sales ?? 0) / c.lifetime.spend)}` : ""}</dd>
              <dt style={{ color: "var(--muted)" }}>Lifetime impressions</dt><dd className="tnum">{c.lifetime.impressions != null ? fmtN(c.lifetime.impressions) : "—"}</dd>
              <dt style={{ color: "var(--muted)" }}>Cities</dt><dd>{c.regionType === "PAN_INDIA" ? "Pan-India" : c.cities.join(", ") || "—"}</dd>
            </dl>
          </Card>
          <Card title="Targeted keywords & bids">
            <div className="flex flex-wrap gap-1.5">{c.targetedKeywords.map((t) => <span key={t.keyword} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--border)" }}>{t.keyword}{t.bids[0]?.cpm ? <span className="tnum" style={{ color: "var(--muted)" }}> · CPM ₹{t.bids[0].cpm}</span> : null}</span>)}</div>
            {!c.targetedKeywords.length && <p className="text-xs" style={{ color: "var(--muted)" }}>No keyword targeting (category / recommendation placement).</p>}
          </Card>
        </div>
      </div>
      <Card title="Advertised products" subtitle="Matched to your Blinkit seller catalog; seller sales are all Blinkit orders in the period, not only ad-driven">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12px]"><thead><tr style={{ color: "var(--muted)" }}>{["Product", "Blinkit product id", "MRP", "Selling price", "Units sold", "Blinkit sales"].map((h) => <th key={h} className={`py-1.5 font-medium ${h === "Product" || h === "Blinkit product id" ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
          <tbody>{d.products.map((p) => <tr key={p.productId} className="border-t" style={{ borderColor: "var(--border)" }}>
            <td className="py-1.5">{p.itemId ? <Link href={`/dashboard/seller/orders?itemId=${p.itemId}`} className="hover:underline">{p.name}</Link> : <span style={{ color: "var(--muted)" }}>Not in the synced seller catalog</span>}</td>
            <td className="tnum">{p.productId}</td><td className="tnum text-right">{inr(p.mrp)}</td><td className="tnum text-right">{inr(p.sellingPrice)}</td><td className="tnum text-right">{fmtN(p.sellerUnits)}</td><td className="tnum text-right">{inr(p.sellerGmv)}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}

export default function AdsCampaignPage() {
  return <AdsShell title="Campaign" subtitle="Performance, keywords, settings and advertised products for one campaign.">{(ctx) => <CampaignView {...ctx} />}</AdsShell>;
}
