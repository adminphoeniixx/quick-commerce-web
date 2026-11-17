"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdsShell, type Metrics, inr, roasText, StatusPill, TYPE_LABEL, type AdsCtx } from "@/components/ads/AdsShell";
import { field, fieldStyle } from "@/components/seller/SellerShell";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtN } from "@/lib/format";
import { CampaignSuggestions } from "@/components/ads/CampaignSuggestions";

interface Row { campaignId: string; name: string; type: string; status: string; startAt: string | null; endAt: string | null; budget: number | null; pacing: string | null; cities: string[]; productIds: string[]; regionType: string | null; lifetime: { spend: number | null; sales: number | null }; period: Metrics }

function CampaignsView({ query, version }: AdsCtx) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  useEffect(() => { apiGet<{ rows: Row[] }>(`/api/ads/campaigns?${query}`).then((r) => setRows(r.rows ?? [])).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load campaigns")); }, [query, version]);
  const shown = useMemo(() => (rows ?? []).filter((r) => (status === "ALL" || r.status === status) && r.name.toLowerCase().includes(search.toLowerCase())), [rows, status, search]);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!rows) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  const statuses = ["ALL", ...Array.from(new Set(rows.map((r) => r.status)))];
  return (
    <div className="space-y-4">
    <CampaignSuggestions query={query} version={version} />
    <Card title={`${shown.length} campaigns`} subtitle="Period metrics for the selected dates; lifetime spend from Blinkit" right={<div className="flex flex-wrap justify-end gap-2">
      <input className={field} style={fieldStyle} placeholder="Search campaign" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search campaigns" />
      <select className={field} style={fieldStyle} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{statuses.map((s) => <option key={s}>{s}</option>)}</select>
    </div>}>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[12px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["Campaign", "Status", "Runs", "Daily budget", "Spend", "Impressions", "CPM", "ATC", "Sales", "ROAS", "New users", "Lifetime spend", "Targeting"].map((h) => <th key={h} className={`py-2 font-medium ${["Campaign", "Status", "Runs", "Targeting"].includes(h) ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.campaignId} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-2 pr-3"><Link href={`/dashboard/ads/campaigns/${r.campaignId}`} className="font-semibold hover:underline">{r.name}</Link><div className="text-[10px]" style={{ color: "var(--muted)" }}>{TYPE_LABEL[r.type] ?? r.type} · #{r.campaignId}</div></td>
              <td><StatusPill status={r.status} /></td>
              <td className="tnum whitespace-nowrap">{r.startAt ? r.startAt.slice(0, 10) : "—"} → {r.endAt ? r.endAt.slice(0, 10) : "no end"}</td>
              <td className="tnum text-right">{inr(r.budget)}{r.pacing ? <span className="text-[10px]" style={{ color: "var(--muted)" }}> {r.pacing.toLowerCase()}</span> : null}</td>
              <td className="tnum text-right font-semibold">{inr(r.period.spend)}</td><td className="tnum text-right">{fmtN(r.period.impressions)}</td><td className="tnum text-right">{inr(r.period.cpm)}</td>
              <td className="tnum text-right">{fmtN(r.period.atc)}</td><td className="tnum text-right">{inr(r.period.sales)}</td><td className="tnum text-right font-semibold">{roasText(r.period.roas)}</td>
              <td className="tnum text-right">{fmtN(r.period.newUsers)}</td><td className="tnum text-right">{inr(r.lifetime.spend)}</td>
              <td className="text-[11px]">{r.regionType === "PAN_INDIA" ? "Pan-India" : r.cities.length ? `${r.cities.length} cities` : "—"} · {r.productIds.length} products</td>
            </tr>))}</tbody>
        </table>
      </div>
    </Card></div>
  );
}

export default function AdsCampaignsPage() {
  return <AdsShell title="Campaigns" subtitle="Every Blinkit Ads campaign with status, budget, targeting and performance.">{(ctx) => <CampaignsView {...ctx} />}</AdsShell>;
}
