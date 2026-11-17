"use client";
// Product SEO / listing health (Keyword Intelligence): Seller Hub listing snapshot per product,
// ad keywords that sell it, city coverage + sales, and rule-based fixes. Data: /api/seo/products.
import { Fragment, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";
import { fmtN } from "@/lib/format";

interface Issue { severity: "high" | "medium" | "low"; code: string; message: string }
interface Kw { keyword: string; spend: number; sales: number; roas: number | null; impressions: number; atc: number; avgPosition: number | null; inListing: boolean }
interface ExpCity { city: string; state?: string; status?: string; live: number | null; new: number | null; closed: number | null; unitsPerStoreDay: number | null; salesPerStoreDay: number | null; availabilityPct: number | null }
interface Product {
  productId: string; itemId: string | null; name: string; brand: string | null; category: string | null; unit: string | null;
  expansionLevel: string | null; availabilityPct: number | null; availabilityTarget: number | null;
  unitsPerStoreDay: number | null; unitsTarget: number | null; salesPerStoreDay: number | null; salesTarget: number | null; complaintPct: number | null;
  stores: { live: number | null; new: number | null; closed: number | null }; cityCount: { live: number | null; new: number | null; closed: number | null };
  assessmentEnd: string | null; period: string | null; units: number | null; sales: number | null; salesSharePct: number | null;
  listing: { titleLength: number; descriptionLength: number; imageCount: number; attrsFilled: number; attrsTotal: number; engagementScore: number | null };
  content: { title?: string; description?: string; hindiName?: string | null; images?: string[]; attributes?: { name: string; value: string }[] };
  missingAttributes: { name: string; group: string | null; mandatory: boolean }[]; expansionCities: ExpCity[];
  salesByCity: { city: string; units: number; sales: number }[]; keywords: Kw[]; issues: Issue[];
}
interface Data { snapshotDate: string | null; from?: string; to?: string; products: Product[]; festive: { festival: string; start: string | null; category: string; keywords: { keyword: string; growth: string | null }[] }[] }

const inr = (n: number | null | undefined) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 10) / 10}%`);
const SEV = { high: "var(--crit)", medium: "var(--warn)", low: "var(--muted)" } as const;
const muted = { color: "var(--muted)" };

function score(p: Product) {
  const l = p.listing;
  const parts = [Math.min(1, l.descriptionLength / 150), Math.min(1, l.imageCount / 5), l.attrsTotal ? l.attrsFilled / l.attrsTotal : 1,
    p.availabilityPct == null ? 1 : Math.min(1, p.availabilityPct / (p.availabilityTarget || 50))];
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

function Detail({ p }: { p: Product }) {
  const th = "py-1.5 font-medium";
  return (
    <div className="grid gap-4 py-3 lg:grid-cols-2">
      <div className="space-y-3">
        <div>
          <h4 className="mb-1 text-xs font-semibold">Fix list</h4>
          {p.issues.length ? <ul className="space-y-1 text-xs">{p.issues.map((i) => <li key={i.code + i.message}><span className="mr-1 font-semibold uppercase" style={{ color: SEV[i.severity] }}>{i.severity}</span>{i.message}</li>)}</ul> : <p className="text-xs" style={muted}>No issues found.</p>}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold">Ad keywords selling this product</h4>
          {p.keywords.length ? <table className="w-full text-[11px]"><thead><tr style={muted}><th className={`${th} text-left`}>Keyword</th><th className={`${th} text-right`}>Spend</th><th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>ROAS</th><th className={`${th} text-right`}>Avg slot</th><th className={`${th} text-right`}>In listing</th></tr></thead>
            <tbody>{p.keywords.map((k) => <tr key={k.keyword} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1">{k.keyword}</td><td className="tnum text-right">{inr(k.spend)}</td><td className="tnum text-right">{inr(k.sales)}</td><td className="tnum text-right">{k.roas == null ? "—" : `${k.roas.toFixed(2)}x`}</td><td className="tnum text-right">{k.avgPosition ?? "—"}</td><td className="text-right" style={{ color: k.inListing ? "var(--ok, green)" : "var(--warn)" }}>{k.inListing ? "yes" : "no"}</td></tr>)}</tbody></table>
            : <p className="text-xs" style={muted}>No ad keyword data for this product in the period (run blinkit_ads_sync).</p>}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold">Listing content</h4>
          <p className="text-xs"><b>Title</b> ({p.listing.titleLength} chars): {p.content.title}</p>
          {p.content.hindiName && <p className="text-xs"><b>Hindi name</b>: {p.content.hindiName}</p>}
          <p className="mt-1 text-xs"><b>Description</b> ({p.listing.descriptionLength} chars): {p.content.description || <i style={muted}>empty</i>}</p>
          {p.missingAttributes.length > 0 && <p className="mt-1 text-xs"><b>Empty attributes</b> ({p.missingAttributes.length}/{p.listing.attrsTotal}): {p.missingAttributes.map((a) => a.name + (a.mandatory ? "*" : "")).join(", ")}</p>}
          {!!p.content.images?.length && <div className="mt-2 flex gap-1 overflow-x-auto">{p.content.images.map((u) => <img key={u} src={u} alt="" className="h-12 w-12 rounded border object-contain" style={{ borderColor: "var(--border)" }} />)}</div>}
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <h4 className="mb-1 text-xs font-semibold">Sales by city ({p.period ?? "period"})</h4>
          {p.salesByCity.length ? <table className="w-full text-[11px]"><thead><tr style={muted}><th className={`${th} text-left`}>City</th><th className={`${th} text-right`}>Units</th><th className={`${th} text-right`}>Sales</th></tr></thead>
            <tbody>{p.salesByCity.map((c) => <tr key={c.city} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1">{c.city}</td><td className="tnum text-right">{fmtN(c.units)}</td><td className="tnum text-right">{inr(c.sales)}</td></tr>)}</tbody></table>
            : <p className="text-xs" style={muted}>No orders synced for this product in the period.</p>}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold">Store coverage by city (Seller Hub expansion)</h4>
          {p.expansionCities.length ? <div className="max-h-72 overflow-y-auto"><table className="w-full text-[11px]"><thead className="sticky top-0" style={{ background: "var(--surface)" }}><tr style={muted}><th className={`${th} text-left`}>City</th><th className={`${th} text-right`}>Live</th><th className={`${th} text-right`}>Closed</th><th className={`${th} text-right`}>Units/store/day</th><th className={`${th} text-right`}>₹/store/day</th><th className={`${th} text-right`}>Availability</th></tr></thead>
            <tbody>{p.expansionCities.map((c) => <tr key={c.city} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1">{c.city}</td><td className="tnum text-right">{c.live ?? "—"}</td><td className="tnum text-right" style={{ color: (c.closed ?? 0) > (c.live ?? 0) ? "var(--crit)" : undefined }}>{c.closed ?? "—"}</td><td className="tnum text-right">{c.unitsPerStoreDay ?? "—"}</td><td className="tnum text-right">{inr(c.salesPerStoreDay)}</td><td className="tnum text-right">{pct(c.availabilityPct)}</td></tr>)}</tbody></table></div>
            : <p className="text-xs" style={muted}>No city breakdown.</p>}
        </div>
      </div>
    </div>
  );
}

export function ProductSeo() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { apiGet<Data>("/api/seo/products").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load product SEO")); }, []);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!data) return <p className="py-8 text-center text-sm" style={muted}>Loading product SEO…</p>;
  if (!data.snapshotDate) return <Card title="Product SEO"><p className="text-xs" style={muted}>No Seller Hub listing data yet. Use <b>Sync SEO now</b> above (needs the Blinkit seller connection), or run any Blinkit sync from the Connections page.</p></Card>;
  const high = data.products.reduce((a, p) => a + p.issues.filter((i) => i.severity === "high").length, 0);
  const th = "py-2 font-medium";
  return (
    <div className="space-y-4">
      <Card title="Product SEO & listing health" subtitle={`Blinkit Seller Hub snapshot ${data.snapshotDate} · ads & orders ${data.from} → ${data.to} · ${data.products.length} products · ${high} high-priority fixes`}>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[1000px] text-[12px]">
          <thead><tr style={muted}>{["Product", "Level", "Availability", "Stores live / closed", "Units/store/day", "Sales", "Listing score", "Top ad keyword", "Fixes"].map((h, i) => <th key={h} className={`${th} ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
          <tbody>{data.products.map((p) => {
            const s = score(p), top = p.keywords[0];
            const hi = p.issues.filter((i) => i.severity === "high").length;
            return <Fragment key={p.productId}>
              <tr className="cursor-pointer border-t" style={{ borderColor: "var(--border)" }} onClick={() => setOpen(open === p.productId ? null : p.productId)}>
                <td className="py-1.5"><span className="mr-1" style={muted}>{open === p.productId ? "▾" : "▸"}</span><b>{p.name}</b> <span className="text-[11px]" style={muted}>{p.unit} · {p.category}</span></td>
                <td className="text-right">{p.expansionLevel ?? "—"}</td>
                <td className="tnum text-right" style={{ color: p.availabilityPct != null && p.availabilityTarget != null && p.availabilityPct < p.availabilityTarget ? "var(--crit)" : undefined }}>{pct(p.availabilityPct)}<span className="text-[10px]" style={muted}> / {pct(p.availabilityTarget)}</span></td>
                <td className="tnum text-right">{p.stores.live ?? "—"} / <span style={{ color: (p.stores.closed ?? 0) > (p.stores.live ?? 0) ? "var(--crit)" : undefined }}>{p.stores.closed ?? "—"}</span></td>
                <td className="tnum text-right">{p.unitsPerStoreDay ?? "—"}<span className="text-[10px]" style={muted}> / {p.unitsTarget ?? "—"}</span></td>
                <td className="tnum text-right">{inr(p.sales)} <span className="text-[10px]" style={muted}>{fmtN(p.units ?? 0)}u</span></td>
                <td className="tnum text-right font-semibold" style={{ color: s < 60 ? "var(--crit)" : s < 80 ? "var(--warn)" : undefined }}>{s}</td>
                <td className="max-w-[160px] truncate text-right" title={top?.keyword}>{top ? `${top.keyword} (${top.roas == null ? "—" : top.roas.toFixed(1) + "x"})` : "—"}</td>
                <td className="text-right">{hi ? <span style={{ color: SEV.high }}>{hi} high</span> : null}{hi && p.issues.length > hi ? " · " : ""}{p.issues.length > hi ? `${p.issues.length - hi} more` : !hi ? "—" : ""}</td>
              </tr>
              {open === p.productId && <tr><td colSpan={9}><Detail p={p} /></td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>
        <p className="mt-2 text-[11px]" style={muted}>Listing score = description length, images, filled customer-facing attributes and availability vs target. Blinkit shows ratings on the app only after 20 customer ratings; the Seller Hub does not expose them.</p>
      </Card>
      {data.festive.length > 0 && <Card title="Rising search keywords (Blinkit Ads · festive)" subtitle="Search growth multiples Blinkit reports for your categories: use them in titles, descriptions and campaigns.">
        <div className="mt-2 grid gap-3 md:grid-cols-2">{data.festive.map((f) => <div key={f.festival + f.category}><p className="text-xs font-semibold">{f.category} <span style={muted}>· {f.festival}{f.start ? ` (${f.start})` : ""}</span></p>
          <p className="mt-1 text-xs leading-6">{f.keywords.map((k) => <span key={k.keyword} className="mr-1 inline-block rounded border px-1.5" style={{ borderColor: "var(--border)" }}>{k.keyword}{k.growth ? <span style={muted}> {k.growth}</span> : null}</span>)}</p></div>)}</div>
      </Card>}
    </div>
  );
}
