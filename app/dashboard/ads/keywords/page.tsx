"use client";
import { useEffect, useMemo, useState } from "react";
import { AdsShell, inr, roasText, type AdsCtx } from "@/components/ads/AdsShell";
import { field, fieldStyle } from "@/components/seller/SellerShell";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtN } from "@/lib/format";

interface Row { keyword: string; matchType: string | null; impressions: number; spend: number; atc: number; sales: number; directSales: number; qty: number; newUsers: number; roas: number | null; cpm: number | null; position: number | null; campaigns: string[] }
type SortKey = "spend" | "sales" | "roas" | "impressions" | "atc";

function KeywordsView({ query, version }: AdsCtx) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("spend");
  useEffect(() => { apiGet<{ rows: Row[] }>(`/api/ads/keywords?${query}`).then((r) => setRows(r.rows ?? [])).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load keywords")); }, [query, version]);
  const shown = useMemo(() => (rows ?? []).filter((r) => r.keyword.toLowerCase().includes(search.toLowerCase())).sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1)), [rows, search, sort]);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!rows) return <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
  const wasted = shown.filter((r) => r.spend > 0 && r.sales === 0);
  return (
    <div className="space-y-4">
      {wasted.length > 0 && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)" }}><b>{wasted.length} keywords</b> spent {inr(wasted.reduce((a, r) => a + r.spend, 0))} with no attributed sales in this period. Top: {wasted.slice(0, 5).map((r) => r.keyword).join(", ")}.</p>}
      <Card title={`${shown.length} keywords`} subtitle="Search keywords and recommendation placements across all campaigns; synced for the last 30 days" right={<div className="flex flex-wrap justify-end gap-2">
        <input className={field} style={fieldStyle} placeholder="Search keyword" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search keywords" />
        <select className={field} style={fieldStyle} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">{(["spend", "sales", "roas", "impressions", "atc"] as SortKey[]).map((s) => <option key={s} value={s}>Sort: {s}</option>)}</select>
      </div>}>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[960px] text-[12px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["Keyword", "Match", "Impressions", "Spend", "CPM", "ATC", "Sales", "ROAS", "Units", "New users", "Avg slot", "Campaigns"].map((h) => <th key={h} className={`py-2 font-medium ${["Keyword", "Match", "Campaigns"].includes(h) ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((r) => <tr key={r.keyword + r.matchType} className="border-t" style={{ borderColor: "var(--border)" }}>
            <td className="py-1.5 font-semibold">{r.keyword}</td><td className="text-[11px]">{r.matchType?.replace("_", " ").toLowerCase() ?? "—"}</td>
            <td className="tnum text-right">{fmtN(r.impressions)}</td><td className="tnum text-right">{inr(r.spend)}</td><td className="tnum text-right">{inr(r.cpm)}</td><td className="tnum text-right">{fmtN(r.atc)}</td>
            <td className="tnum text-right">{inr(r.sales)}</td><td className="tnum text-right font-semibold">{roasText(r.roas)}</td><td className="tnum text-right">{fmtN(r.qty)}</td><td className="tnum text-right">{fmtN(r.newUsers)}</td>
            <td className="tnum text-right">{r.position ?? "—"}</td><td className="max-w-[220px] truncate text-[11px]" title={r.campaigns.join(", ")}>{r.campaigns.join(", ")}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

export default function AdsKeywordsPage() {
  return <AdsShell title="Keywords" subtitle="Search keyword performance across Blinkit Ads campaigns.">{(ctx) => <KeywordsView {...ctx} />}</AdsShell>;
}
