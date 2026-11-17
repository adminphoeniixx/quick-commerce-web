"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AdsShell, Kpi, inr, type AdsCtx } from "@/components/ads/AdsShell";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtINR, fmtDay } from "@/lib/format";

interface FestiveKeyword { keyword: string; growth_multiple: number; growth_multiple_label?: string }
interface Insights {
  empty?: boolean; advertiserName: string | null; advertiserId: string; status: string | null; compliance: string | null; snapshotDate: string; updatedAt: string;
  walletBalance: number | null; tentativeSpend: number | null; creditBalance: number | null;
  festive: { summary: { festival_name?: string; festival_start_date?: string; festival_end_date?: string; categories_spiking?: number; growth_peak_label?: string; recommended_go_live?: { start: string; end: string } } | null;
    keywords: { festivals?: { name: string; start_date: string; categories: { category_name: string; keywords: FestiveKeyword[] }[] }[] } | null } | null;
  collections: { id: number; collection_name: string; number_of_products: number; created_on: string; sort: string | null }[] | null;
  walletHistory: { date: string; wallet: number | null; credit: number | null }[];
}

function InsightsView({ brandId, version }: AdsCtx) {
  const [d, setD] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiGet<Insights>(`/api/ads/insights?brandId=${brandId}`).then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load insights")); }, [brandId, version]);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!d) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (d.empty) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>No account snapshot synced yet.</p>;
  const fs = d.festive?.summary, festivals = d.festive?.keywords?.festivals ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Ads wallet balance" value={inr(d.walletBalance)} sub={`as of ${d.snapshotDate}`} />
        <Kpi label="Spend not yet billed" value={inr(d.tentativeSpend)} sub="tentative, deducted from wallet" />
        <Kpi label="Ad credit" value={inr(d.creditBalance)} />
        <Kpi label="Advertiser" value={d.advertiserName ?? "—"} sub={`#${d.advertiserId} · ${d.status?.toLowerCase() ?? ""}${d.compliance ? ` · compliance ${d.compliance.toLowerCase()}` : ""}`} />
      </div>
      {d.walletHistory.length > 1 && <Card title="Wallet balance" subtitle="One point per sync day">
        <div className="h-[200px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={d.walletHistory} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} /><XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis tickFormatter={(v) => fmtINR(v).replace("₹", "")} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => inr(Number(v))} labelFormatter={(l) => fmtDay(String(l))} />
          <Line dataKey="wallet" name="Wallet" stroke="var(--blinkit)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>
      </Card>}
      {fs && <Card title={`Festive demand: ${fs.festival_name ?? ""}`} subtitle={`${fs.festival_start_date ?? ""} – ${fs.festival_end_date ?? ""} · ${fs.categories_spiking ?? 0} of your categories spiking (peak ${fs.growth_peak_label ?? "—"})${fs.recommended_go_live ? ` · Blinkit recommends going live ${fs.recommended_go_live.start} – ${fs.recommended_go_live.end}` : ""}`}>
        <div className="mt-2 grid gap-4 md:grid-cols-2">{festivals.flatMap((f) => f.categories.map((cat) => (
          <div key={f.name + cat.category_name}>
            <p className="mb-1 text-[12px] font-semibold">{cat.category_name} <span style={{ color: "var(--muted)" }}>· {f.name}</span></p>
            <table className="w-full text-[12px]"><tbody>{cat.keywords.slice(0, 12).map((k) => <tr key={k.keyword} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1">{k.keyword}</td><td className="tnum text-right font-semibold">{k.growth_multiple.toFixed(1)}x</td><td className="text-right text-[11px]" style={{ color: "var(--muted)" }}>{k.growth_multiple_label}</td></tr>)}</tbody></table>
          </div>)))}</div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>Growth multiple = search demand during the festival vs. normal days, from Blinkit.</p>
      </Card>}
      <Card title="Brand collections" subtitle="Collections used by brand store and banner campaigns">
        <table className="w-full text-[12px]"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1.5 text-left font-medium">Collection</th><th className="text-right font-medium">Products</th><th className="text-right font-medium">Sort</th><th className="text-right font-medium">Created</th></tr></thead>
          <tbody>{(d.collections ?? []).map((c) => <tr key={c.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1.5">{c.collection_name}</td><td className="tnum text-right">{c.number_of_products}</td><td className="text-right">{c.sort ?? "—"}</td><td className="tnum text-right">{c.created_on.slice(0, 10)}</td></tr>)}</tbody></table>
        {!d.collections?.length && <p className="py-4 text-center text-xs" style={{ color: "var(--muted)" }}>No collections.</p>}
      </Card>
    </div>
  );
}

export default function AdsInsightsPage() {
  return <AdsShell dated={false} title="Account & insights" subtitle="Wallet, ad credit, festive demand and brand collections from Blinkit Ads.">{(ctx) => <InsightsView {...ctx} />}</AdsShell>;
}
