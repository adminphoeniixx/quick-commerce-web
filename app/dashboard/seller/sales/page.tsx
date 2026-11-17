"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SellerShell, Empty, type SellerMeta } from "@/components/seller/SellerShell";
import { SalesTrend } from "@/components/SalesTrend";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtINR, fmtN } from "@/lib/format";
import { DateRangeFilter, type DateSelection } from "@/components/seller/DateRangeFilter";
import { platformName } from "@/lib/platforms";
import { AdsSummary } from "@/components/ads/AdsSummary";
import type { Channel } from "@/lib/types";

interface Row { key: string; gmv: number; units: number; orders: number; share: number }
interface Summary {
  empty?: boolean;
  range: { from: string; to: string };
  kpis: { gmv: number; units: number; orders: number; lines: number; tax: number; aov: number | null; unitsPerOrder: number | null; discountPct: number | null; notSoldLines: number; notSoldValue: number };
  trend: { date: string; gmv: number; units: number; orders: number }[];
  products: { itemId: string; name: string; gmv: number; units: number; orders: number; mrp: number | null; avgPrice: number | null; share: number }[];
  customerCities: Row[]; customerStates: Row[]; supplyCities: Row[]; categories: Row[];
  statuses: { status: string; lines: number; value: number }[];
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function Kpi({ label, value, sub, comparison }: { label: string; value: string; sub?: string; comparison?: number | null }) {
  return (
    <div className="rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[12px]" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="tnum mt-1 text-xl font-bold">{value}</p>
      {comparison != null && <p className="tnum mt-1 text-[11px] font-semibold" style={{ color: comparison > 0 ? "var(--good)" : comparison < 0 ? "var(--crit)" : "var(--muted)" }}>{comparison > 0 ? "↑" : comparison < 0 ? "↓" : "—"} {Math.abs(comparison).toFixed(1)}% vs previous period</p>}
      {sub && <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

// Ranked table with a single-hue share bar; values stay in text ink.
function Breakdown({ title, rows, keyLabel }: { title: string; rows: Row[]; keyLabel: string }) {
  return (
    <Card title={title}>
      {rows.length ? (
        <table className="w-full text-[12px]">
          <thead><tr style={{ color: "var(--muted)" }}><th className="py-1.5 text-left font-medium">{keyLabel}</th><th className="text-right font-medium">Sales</th><th className="text-right font-medium">Units</th><th className="text-right font-medium">Orders</th></tr></thead>
          <tbody>{rows.slice(0, 12).map((r) => (
            <tr key={r.key} className="border-t" style={{ borderColor: "var(--border)" }} title={`${r.key}: ${inr(r.gmv)} · ${(r.share * 100).toFixed(1)}% of sales`}>
              <td className="py-1.5 pr-2">
                <div>{r.key}</div>
                <div className="mt-1 h-1 rounded-full" style={{ background: "var(--surface-2)" }}><div className="h-1 rounded-full" style={{ width: `${Math.max(2, r.share * 100)}%`, background: "var(--blinkit)" }} /></div>
              </td>
              <td className="tnum text-right">{inr(r.gmv)}</td><td className="tnum text-right">{fmtN(r.units)}</td><td className="tnum text-right">{fmtN(r.orders)}</td>
            </tr>))}</tbody>
        </table>
      ) : <p className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>No data for this period.</p>}
    </Card>
  );
}

const pct = (current: number, previous: number | undefined) => previous == null || previous === 0 ? null : ((current - previous) / previous) * 100;

function SalesView({ brandId, platform, meta, version }: { brandId: string; platform: string; meta: SellerMeta; version: number }) {
  const available = useMemo(() => ({ from: meta.from ?? new Date().toISOString().slice(0, 10), to: meta.to ?? new Date().toISOString().slice(0, 10) }), [meta.from, meta.to]);
  const [dates, setDates] = useState<DateSelection>({ range: available, preset: "maximum", compare: false, comparison: null });
  const [data, setData] = useState<Summary | null>(null);
  const [comparison, setComparison] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { setDates({ range: available, preset: "maximum", compare: false, comparison: null }); }, [available, platform]);
  useEffect(() => {
    if (!meta.from) return;
    setError("");
    const common = `brandId=${brandId}&platform=${platform}`;
    const primary = apiGet<Summary>(`/api/seller/sales?${common}&from=${dates.range.from}&to=${dates.range.to}`);
    const prior = dates.compare && dates.comparison ? apiGet<Summary>(`/api/seller/sales?${common}&from=${dates.comparison.from}&to=${dates.comparison.to}`) : Promise.resolve(null);
    Promise.all([primary, prior]).then(([next, previous]) => { setData(next); setComparison(previous); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load sales"));
  }, [brandId, platform, dates, version, meta.from]);

  if (!meta.from) return <Empty text={`No ${platformName(platform)} sales yet. Connect or import ${platformName(platform)} data to view sales, orders and products.`} />;
  const k = data?.kpis;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><DateRangeFilter value={dates} available={available} onChange={setDates} />{dates.compare && comparison && <span className="text-[12px]" style={{ color: "var(--muted)" }}>Compared with {comparison.range.from} – {comparison.range.to}</span>}</div>
      {error && <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>}
      {k && data && (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Total sales (GMV)" value={inr(k.gmv)} comparison={pct(k.gmv, comparison?.kpis.gmv)} sub="incl. tax, delivered orders" />
          <Kpi label="Units sold" value={fmtN(k.units)} comparison={pct(k.units, comparison?.kpis.units)} />
          <Kpi label="Orders" value={fmtN(k.orders)} comparison={pct(k.orders, comparison?.kpis.orders)} sub={`${fmtN(k.lines)} order lines`} />
          <Kpi label="Avg order value" value={k.aov != null ? inr(k.aov) : "—"} comparison={k.aov != null ? pct(k.aov, comparison?.kpis.aov ?? undefined) : null} sub={k.unitsPerOrder != null ? `${k.unitsPerOrder.toFixed(2)} units / order` : undefined} />
          <Kpi label="Avg discount vs MRP" value={k.discountPct != null ? `${k.discountPct.toFixed(1)}%` : "—"} comparison={k.discountPct != null ? pct(k.discountPct, comparison?.kpis.discountPct ?? undefined) : null} />
          <Kpi label="Tax collected" value={inr(k.tax)} comparison={pct(k.tax, comparison?.kpis.tax)} sub={k.notSoldLines ? `${fmtN(k.notSoldLines)} cancelled/returned lines (${inr(k.notSoldValue)}) excluded` : "no cancellations"} />
        </div>
        {platform === "blinkit" && <AdsSummary compact brandId={brandId} from={data.range.from} to={data.range.to} />}
        <SalesTrend series={data.trend.map((t) => ({ date: t.date, [platform]: t.gmv }))} channel={platform as Channel} total={k.gmv} />
        <Card title="Sales by product" subtitle="Delivered order lines in the selected period">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead><tr style={{ color: "var(--muted)" }}>{["Product", "Item ID", "Units", "Orders", "Sales", "Avg price", "MRP", "Share"].map((h) => <th key={h} className={`py-2 font-medium ${h === "Product" || h === "Item ID" ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
              <tbody>{data.products.map((p) => (
                <tr key={p.itemId} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-3"><Link href={`/dashboard/seller/orders?itemId=${p.itemId}`} className="hover:underline">{p.name}</Link></td>
                  <td className="tnum">{p.itemId}</td><td className="tnum text-right">{fmtN(p.units)}</td><td className="tnum text-right">{fmtN(p.orders)}</td>
                  <td className="tnum text-right font-semibold">{inr(p.gmv)}</td><td className="tnum text-right">{p.avgPrice != null ? inr(p.avgPrice) : "—"}</td>
                  <td className="tnum text-right">{p.mrp != null ? inr(p.mrp) : "—"}</td><td className="tnum text-right">{(p.share * 100).toFixed(1)}%</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="Sales by customer city" keyLabel="City" rows={data.customerCities} />
          <Breakdown title="Sales by customer state" keyLabel="State" rows={data.customerStates} />
          <Breakdown title="Sales by supply city (dark store region)" keyLabel="Supply city" rows={data.supplyCities} />
          <Breakdown title="Sales by business category" keyLabel="Category" rows={data.categories} />
        </div>
        <Card title="Order status" subtitle="All order lines in the period, including ones excluded from sales">
          <div className="flex flex-wrap gap-6 text-[13px]">{data.statuses.map((s) => (
            <div key={s.status}><p className="text-[11px]" style={{ color: "var(--muted)" }}>{s.status}</p><p className="tnum font-semibold">{fmtN(s.lines)} lines · {inr(s.value)}</p></div>
          ))}</div>
        </Card>
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>Figures come from {platformName(platform)}&apos;s order-level Sales Summary export. {fmtINR(k.gmv)} is gross bill amount including tax. Cancelled, returned and RTO lines are excluded from sales.</p>
      </>)}
    </div>
  );
}

export default function SellerSalesPage() {
  return (
    <SellerShell title="Sales analysis" subtitle="Sales totals, trends, products, cities, states, categories and order status for the selected platform.">
      {(ctx) => <SalesView {...ctx} />}
    </SellerShell>
  );
}
