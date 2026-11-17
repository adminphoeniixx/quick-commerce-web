"use client";
import { Fragment, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { SellerShell, Empty, field, fieldStyle, type SellerMeta } from "@/components/seller/SellerShell";
import { apiGet, ApiError } from "@/lib/client/api";

interface Order {
  id: string; orderId: string; itemId: string; orderDate: string; productName: string; variant: string | null; status: string;
  quantity: number; mrp: string | null; sellingPrice: string | null; grossAmount: string; totalTax: string | null;
  customerCity: string | null; customerState: string | null; supplyCity: string | null; businessCategory: string | null; hsn: string | null;
  cgstValue: string | null; sgstValue: string | null; igstValue: string | null;
}
interface Resp { results: Order[]; meta: { total_items: number; page: number; total_pages: number }; filters: { statuses: string[]; cities: string[] } }

const inr = (v: string | null) => (v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

function OrdersView({ brandId, platform, meta, version }: { brandId: string; platform: string; meta: SellerMeta; version: number }) {
  const search = useSearchParams();
  const [from, setFrom] = useState(meta.from ?? "");
  const [to, setTo] = useState(meta.to ?? "");
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const [q, setQ] = useState(search.get("itemId") ?? "");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const params = new URLSearchParams({ brandId, platform, ...(from && to ? { from, to } : {}), ...(status ? { status } : {}), ...(city ? { city } : {}), ...(q ? { q } : {}) });
  const qs = params.toString();
  useEffect(() => { setPage(1); }, [qs]);
  useEffect(() => {
    if (!meta.from) return;
    const t = setTimeout(() => apiGet<Resp>(`/api/seller/orders?${qs}&page=${page}&page_size=50`).then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load orders")), 250);
    return () => clearTimeout(t);
  }, [qs, page, version, meta.from]);

  if (!meta.from) return <Empty text="No orders for the selected platform yet. Connect or import platform data first." />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search orders" className={field + " min-w-[220px]"} style={fieldStyle} placeholder="Order ID, product or item ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" aria-label="From" className={field} style={fieldStyle} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" aria-label="To" className={field} style={fieldStyle} value={to} onChange={(e) => setTo(e.target.value)} />
        <select aria-label="Status" className={field} style={fieldStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{data?.filters.statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Customer city" className={field} style={fieldStyle} value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">All cities</option>{data?.filters.cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <a href={`/api/seller/orders?${qs}&format=csv`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold" style={{ borderColor: "var(--border)" }}><Download size={14} />Export CSV</a>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>}
      <div className="overflow-x-auto rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full min-w-[980px] text-[12px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["Order date", "Order ID", "Product", "Qty", "MRP", "Selling price", "Bill amount", "Tax", "Customer city", "Supply city", "Status"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{data?.results.map((o) => (<Fragment key={o.id}>
            <tr onClick={() => setOpen(open === o.id ? null : o.id)} className="cursor-pointer border-t" style={{ borderColor: "var(--border)" }}>
              <td className="tnum whitespace-nowrap px-3 py-2">{o.orderDate.slice(0, 10)}</td><td className="tnum px-3">{o.orderId}</td>
              <td className="px-3">{o.productName}<div className="text-[11px]" style={{ color: "var(--muted)" }}>Item {o.itemId}</div></td>
              <td className="tnum px-3">{o.quantity}</td><td className="tnum px-3">{inr(o.mrp)}</td><td className="tnum px-3">{inr(o.sellingPrice)}</td>
              <td className="tnum px-3 font-semibold">{inr(o.grossAmount)}</td><td className="tnum px-3">{inr(o.totalTax)}</td>
              <td className="px-3">{o.customerCity ?? "—"}<div className="text-[11px]" style={{ color: "var(--muted)" }}>{o.customerState}</div></td>
              <td className="px-3">{o.supplyCity ?? "—"}</td><td className="px-3">{o.status}</td>
            </tr>
            {open === o.id && <tr className="border-t" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}><td colSpan={11} className="px-3 py-2 text-[11px]">
              Variant: {o.variant ?? "—"} · Category: {o.businessCategory ?? "—"} · HSN: {o.hsn ?? "—"} · CGST {inr(o.cgstValue)} · SGST {inr(o.sgstValue)} · IGST {inr(o.igstValue)}
            </td></tr>}
          </Fragment>))}</tbody>
        </table>
        {data && !data.results.length && <p className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>No orders match these filters.</p>}
      </div>
      {data && data.meta.total_pages > 1 && (
        <div className="flex items-center justify-end gap-3 text-[12px]">
          <span style={{ color: "var(--muted)" }}>{data.meta.total_items.toLocaleString("en-IN")} order lines · page {page} of {data.meta.total_pages}</span>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-2 py-1" style={{ borderColor: "var(--border)" }}>Previous</button>
          <button disabled={page >= data.meta.total_pages} onClick={() => setPage(page + 1)} className="rounded border px-2 py-1" style={{ borderColor: "var(--border)" }}>Next</button>
        </div>
      )}
    </div>
  );
}

export default function SellerOrdersPage() {
  return (
    <Suspense>
    <SellerShell title="Orders" subtitle="Every order line for the selected platform with product, price, tax, city and status. Click a row for tax details.">
        {(ctx) => <OrdersView {...ctx} />}
      </SellerShell>
    </Suspense>
  );
}
