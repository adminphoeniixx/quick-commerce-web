"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { SellerShell, Empty, field, fieldStyle, type SellerMeta } from "@/components/seller/SellerShell";
import { apiGet, ApiError } from "@/lib/client/api";
import { DateRangeFilter, type DateSelection } from "@/components/seller/DateRangeFilter";
import { platformName } from "@/lib/platforms";

interface Product {
  id: string; itemId: string; productId: string | null; upc: string | null; name: string; brandName: string | null; uom: string | null;
  mrp: string | null; sellingPrice: string | null; status: string | null; businessCategory: string | null; manufacturer: string | null;
  hsn: string | null; gstPct: string | null; commissionPct: string | null; commissionValue: string | null; fulfillmentFee: string | null;
  details: { group: string; fields: { label: string; value: string | number | null }[] }[]; updatedAt: string;
  sales: { units: number; gmv: number; lastOrder: string } | null;
}

const inr = (v: string | number | null | undefined) => (v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

function ProductsView({ brandId, platform, meta, version }: { brandId: string; platform: string; meta: SellerMeta; version: number }) {
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [ads, setAds] = useState<Record<string, { campaigns: number; active: number; campaignSpend: number; campaignSales: number; names: string[] }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const available = { from: meta.from ?? new Date().toISOString().slice(0, 10), to: meta.to ?? new Date().toISOString().slice(0, 10) };
  const [dates, setDates] = useState<DateSelection>({ range: available, preset: "maximum", compare: false, comparison: null });

  useEffect(() => setDates({ range: available, preset: "maximum", compare: false, comparison: null }), [meta.from, meta.to, platform]);

  useEffect(() => {
    const params = new URLSearchParams({ brandId, platform, from: dates.range.from, to: dates.range.to, ...(q ? { q } : {}) });
    const t = setTimeout(() => apiGet<{ products: Product[] }>(`/api/seller/products?${params}`)
      .then((r) => setProducts(r.products)).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load products")), 250);
    return () => clearTimeout(t);
  }, [brandId, platform, q, dates.range.from, dates.range.to, version]);

  // Blinkit Ads campaigns promoting each product (joined on the Blinkit product id).
  useEffect(() => {
    if (platform !== "blinkit") { setAds({}); return; }
    apiGet<{ products: typeof ads }>(`/api/ads/products?brandId=${brandId}&from=${dates.range.from}&to=${dates.range.to}`).then((r) => setAds(r.products)).catch(() => setAds({}));
  }, [brandId, platform, dates.range.from, dates.range.to, version]);

  if (products && !products.length && !q) return <Empty text={`No ${platformName(platform)} products yet. Connect or import ${platformName(platform)} data to pull your catalog.`} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><input aria-label="Search products" className={field + " min-w-[280px]"} style={fieldStyle} placeholder="Name, item ID, product ID or UPC" value={q} onChange={(e) => setQ(e.target.value)} /><DateRangeFilter value={dates} available={available} onChange={setDates} allowCompare={false} /></div>
      {error && <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>}
      <div className="overflow-x-auto rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full min-w-[1050px] text-[12px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["Product", "IDs", "UoM", "MRP", "Selling price", "Status", "Category", "GST", "Commission", "Fulfilment fee", "Units sold", "Sales", "Blinkit Ads"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{products?.map((p) => (
            <Fragment key={p.id}>
              <tr onClick={() => setOpen(open === p.id ? null : p.id)} className="cursor-pointer border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-3 py-2 font-semibold">{p.name}<div className="text-[11px] font-normal" style={{ color: "var(--muted)" }}>{p.brandName}</div></td>
                <td className="tnum px-3 text-[11px]">Item {p.itemId}<br />PID {p.productId ?? "—"}<br />UPC {p.upc ?? "—"}</td>
                <td className="px-3">{p.uom ?? "—"}</td><td className="tnum px-3">{inr(p.mrp)}</td><td className="tnum px-3">{inr(p.sellingPrice)}</td>
                <td className="px-3">{p.status?.replaceAll("_", " ") ?? "—"}</td><td className="px-3">{p.businessCategory ?? "—"}</td>
                <td className="tnum px-3">{p.gstPct != null ? `${Number(p.gstPct)}%` : "—"}</td>
                <td className="tnum px-3">{p.commissionPct != null ? `${Number(p.commissionPct)}% (${inr(p.commissionValue)})` : "—"}</td>
                <td className="tnum px-3">{inr(p.fulfillmentFee)}</td>
                <td className="tnum px-3">{p.sales ? p.sales.units.toLocaleString("en-IN") : "0"}</td>
                <td className="tnum px-3">{p.sales ? <Link href={`/dashboard/seller/orders?itemId=${p.itemId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{inr(p.sales.gmv)}</Link> : "—"}</td>
                <td className="px-3 text-[11px]">{p.productId && ads[p.productId] ? <Link href="/dashboard/ads/campaigns" onClick={(e) => e.stopPropagation()} className="hover:underline" title={ads[p.productId].names.join(", ")}>
                  {ads[p.productId].campaigns} campaigns{ads[p.productId].active ? ` (${ads[p.productId].active} active)` : ""}<br /><span className="tnum" style={{ color: "var(--muted)" }}>spend {inr(ads[p.productId].campaignSpend)}</span></Link> : "—"}</td>
              </tr>
              {open === p.id && (
                <tr className="border-t" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}><td colSpan={13} className="px-3 py-3">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {(Array.isArray(p.details) ? p.details : []).map(({ group, fields }) => (
                      <div key={group}>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>{group}</p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                          {fields.map(({ label, value }) => <Fragment key={label}><dt style={{ color: "var(--muted)" }}>{label}</dt><dd className="tnum">{value === null || value === "" ? "—" : String(value)}</dd></Fragment>)}
                        </dl>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>Last updated from {platformName(platform)} {new Date(p.updatedAt).toLocaleString()}{p.sales ? ` · last order ${p.sales.lastOrder}` : ""}</p>
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
        {products && !products.length && <p className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>No products match.</p>}
      </div>
    </div>
  );
}

export default function SellerProductsPage() {
  return (
    <SellerShell title="Products" subtitle="Your selected platform catalog with IDs, prices, status, dimensions, tax, commission and fees. Click a product for all fields.">
      {(ctx) => <ProductsView {...ctx} />}
    </SellerShell>
  );
}
