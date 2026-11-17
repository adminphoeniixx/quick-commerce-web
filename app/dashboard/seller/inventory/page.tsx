"use client";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SellerShell, Empty, type SellerMeta } from "@/components/seller/SellerShell";
import { apiGet, ApiError } from "@/lib/client/api";

interface Line { warehouseName: string; city: string; sellable: number; warehouse: number; inBetween: number; darkstore: number; unsellable: number; damaged: number; nearExpiry: number; expired: number; incoming: number; sold7d: number; sold30d: number }
interface Product { itemId: string; itemName: string; uom: string | null; sellable: number; darkstore: number; warehouse: number; inBetween: number; unsellable: number; incoming: number; sold7d: number; sold30d: number; warehouses: number; warehousesInStock: number; cities: number; citiesOos: string[]; daysOfCover: number | null; lines: Line[] }
interface Resp { snapshotDate: string | null; totals: { sellable: number; darkstore: number; warehouse: number; inBetween: number; unsellable: number; incoming: number; sold30d: number; products: number; warehouses: number; outOfStockProducts: number } | null; products: Product[] }

const n = (v: number) => v.toLocaleString("en-IN");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[12px]" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="tnum mt-1 text-[20px] font-semibold">{value}</p>
      {sub && <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

function cover(days: number | null) {
  if (days == null) return { text: "No recent sales", color: "var(--muted)" };
  if (days < 7) return { text: `${days} days · reorder now`, color: "var(--crit)" };
  if (days < 21) return { text: `${days} days · low`, color: "var(--warn)" };
  return { text: `${days} days`, color: "var(--ink)" };
}

function InventoryView({ brandId, platform, version }: { brandId: string; platform: string; meta: SellerMeta; version: number }) {
  const [data, setData] = useState<Resp | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiGet<Resp>(`/api/seller/inventory?brandId=${brandId}&platform=${platform}`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load inventory"));
  }, [brandId, platform, version]);

  if (error) return <p className="text-[13px]" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!data) return <p className="py-10 text-center text-[13px]" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!data.totals) return <Empty text="No stock data yet. Press Sync now: QCP pulls Blinkit's Stock on Hand report with every sync." />;
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Sellable units" value={n(t.sellable)} sub={`as of ${data.snapshotDate}`} />
        <Stat label="In dark stores" value={n(t.darkstore)} sub="ready to sell to customers" />
        <Stat label="In warehouses" value={n(t.warehouse)} sub={`${t.warehouses} warehouses`} />
        <Stat label="In transit" value={n(t.inBetween)} sub="warehouse → dark store" />
        <Stat label="Unsellable" value={n(t.unsellable)} sub="damaged, lost, expired, near expiry" />
        <Stat label="Out of stock" value={`${t.outOfStockProducts} / ${t.products}`} sub="products with no sellable units" />
      </div>
      <div className="overflow-x-auto rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full min-w-[1000px] text-[13px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["", "Product", "Sellable", "Dark store", "Warehouse", "In transit", "Unsellable", "Sold 7d", "Sold 30d", "Stock cover", "Warehouses in stock", "Cities out of stock"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-[12px] font-medium">{h}</th>)}</tr></thead>
          <tbody>{data.products.map((p) => {
            const c = cover(p.daysOfCover);
            return (
              <Fragment key={p.itemId}>
                <tr onClick={() => setOpen(open === p.itemId ? null : p.itemId)} className="cursor-pointer border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="pl-4">{open === p.itemId ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                  <td className="px-4 py-3 font-medium">{p.itemName}<div className="text-[12px] font-normal" style={{ color: "var(--muted)" }}>Item {p.itemId}{p.uom ? ` · ${p.uom}` : ""}</div></td>
                  <td className="tnum px-4 font-semibold">{n(p.sellable)}</td><td className="tnum px-4">{n(p.darkstore)}</td><td className="tnum px-4">{n(p.warehouse)}</td>
                  <td className="tnum px-4">{n(p.inBetween)}</td><td className="tnum px-4">{n(p.unsellable)}</td><td className="tnum px-4">{n(p.sold7d)}</td><td className="tnum px-4">{n(p.sold30d)}</td>
                  <td className="whitespace-nowrap px-4" style={{ color: c.color }}>{c.text}</td>
                  <td className="tnum px-4">{p.warehousesInStock} / {p.warehouses}</td>
                  <td className="px-4 text-[12px]">{p.citiesOos.length ? p.citiesOos.join(", ") : "—"}</td>
                </tr>
                {open === p.itemId && (
                  <tr style={{ background: "var(--surface-2)" }}><td colSpan={12} className="px-4 py-3">
                    <table className="w-full text-[12px]">
                      <thead><tr style={{ color: "var(--muted)" }}>{["Warehouse", "City", "Sellable", "Dark store", "Warehouse", "In transit", "Unsellable", "Damaged", "Near expiry", "Expired", "Incoming", "Sold 7d", "Sold 30d"].map((h) => <th key={h} className="py-1.5 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
                      <tbody>{p.lines.map((l) => (
                        <tr key={l.warehouseName} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="py-1.5 pr-3">{l.warehouseName}</td><td className="pr-3">{l.city}</td>
                          <td className="tnum pr-3 font-semibold" style={{ color: l.sellable === 0 ? "var(--crit)" : undefined }}>{n(l.sellable)}</td>
                          <td className="tnum pr-3">{n(l.darkstore)}</td><td className="tnum pr-3">{n(l.warehouse)}</td><td className="tnum pr-3">{n(l.inBetween)}</td>
                          <td className="tnum pr-3">{n(l.unsellable)}</td><td className="tnum pr-3">{n(l.damaged)}</td><td className="tnum pr-3">{n(l.nearExpiry)}</td><td className="tnum pr-3">{n(l.expired)}</td>
                          <td className="tnum pr-3">{n(l.incoming)}</td><td className="tnum pr-3">{n(l.sold7d)}</td><td className="tnum pr-3">{n(l.sold30d)}</td>
                        </tr>))}</tbody>
                    </table>
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table>
      </div>
      <p className="text-[12px]" style={{ color: "var(--muted)" }}>From Blinkit&apos;s Stock on Hand report. Stock cover = sellable units ÷ average daily units sold over the last 30 days.</p>
    </div>
  );
}

export default function SellerInventoryPage() {
  return (
    <SellerShell title="Inventory" subtitle="Stock on hand for the selected platform: sellable, in transit, unsellable, and how many days it will last.">
      {(ctx) => <InventoryView {...ctx} />}
    </SellerShell>
  );
}
