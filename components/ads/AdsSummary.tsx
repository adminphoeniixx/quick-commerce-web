"use client";
// Blinkit Ads widget for the main dashboard and the seller sales page: spend, attributed
// sales, ROAS, TACoS against Blinkit seller sales, wallet, active campaigns.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { apiGet } from "@/lib/client/api";
import { Card } from "@/components/Card";
import { fmtN, fmtDay } from "@/lib/format";

interface Summary {
  connected: boolean; hasData: boolean; spend: number; sales: number; impressions: number; atc: number; roas: number | null; cpm: number | null;
  sellerGmv: number; tacos: number | null; adSalesShare: number | null; walletBalance: number | null; activeCampaigns: number;
  trend: { date: string; spend: number; sales: number }[];
}
const inr = (n: number | null) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><p className="text-[11px]" style={{ color: "var(--muted)" }}>{label}</p><p className="tnum text-[17px] font-bold">{value}</p>{sub && <p className="text-[10px]" style={{ color: "var(--muted)" }}>{sub}</p>}</div>;
}

export function AdsSummary({ brandId, from, to, compact = false }: { brandId: string | null; from: string; to: string; compact?: boolean }) {
  const [d, setD] = useState<Summary | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ from, to, ...(brandId ? { brandId } : {}) });
    apiGet<Summary>(`/api/ads/summary?${q}`).then(setD).catch(() => setD(null));
  }, [brandId, from, to]);
  if (!d) return null;
  if (!d.connected && !d.hasData) {
    return compact ? null : (
      <Card title="Blinkit Ads" subtitle="Ad spend, ROAS and TACoS">
        <p className="py-3 text-[13px]" style={{ color: "var(--muted)" }}>Connect your Blinkit Ads account (brands.blinkit.com) to see ad spend next to sales. <Link href="/dashboard/connections" className="font-semibold underline" style={{ color: "var(--accent)" }}>Connect Blinkit Ads</Link></p>
      </Card>
    );
  }
  return (
    <Card title="Blinkit Ads" subtitle={`${from} – ${to}${d.activeCampaigns ? ` · ${d.activeCampaigns} active campaigns` : ""}`}
      right={<Link href="/dashboard/ads" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent)" }}><Megaphone size={13} />Ads dashboard →</Link>}>
      <div className={`mt-2 grid gap-4 ${compact ? "grid-cols-2 md:grid-cols-6" : "grid-cols-2 md:grid-cols-4 xl:grid-cols-7"}`}>
        <Stat label="Ad spend" value={inr(d.spend)} sub={d.cpm != null ? `CPM ${inr(d.cpm)}` : undefined} />
        <Stat label="Ad-attributed sales" value={inr(d.sales)} />
        <Stat label="ROAS" value={d.roas == null ? "—" : `${d.roas.toFixed(2)}x`} />
        <Stat label="TACoS" value={pct(d.tacos)} sub={d.sellerGmv ? `of ${inr(d.sellerGmv)} Blinkit sales` : "no seller sales"} />
        <Stat label="Sales from ads" value={pct(d.adSalesShare)} />
        <Stat label="Impressions" value={fmtN(d.impressions)} sub={`${fmtN(d.atc)} add to carts`} />
        {!compact && <Stat label="Ads wallet" value={inr(d.walletBalance)} />}
      </div>
      {!compact && d.trend.length > 1 && (
        <div className="mt-3 h-[70px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={d.trend} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <Tooltip formatter={(v) => inr(Number(v))} labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtDay(p[0].payload.date) : "")} />
              <Area dataKey="spend" name="Ad spend" stroke="var(--blinkit)" fill="var(--blinkit)" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
