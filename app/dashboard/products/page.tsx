"use client";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { apiGet } from "@/lib/client/api";
import { fmtINR } from "@/lib/format";
import { useEffect, useState } from "react";
type Product = { id:string; title:string; brand?:string; category?:string; packSize?:string; imageUrl?:string; platform:string; productUrl:string; lastObservedAt:string; currentPrice?:{sellingPrice:string;mrp?:string;discountPct?:string;city:string;sourceUrl:string};currentAvailability?:{availabilityStatus:string} };

function MarketObservations() {
  const [products,setProducts]=useState<Product[]>([]); const [keyword,setKeyword]=useState(""); const [platform,setPlatform]=useState(""); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  useEffect(()=>{const controller=new AbortController(); const params=new URLSearchParams(); if(keyword)params.set("keyword",keyword);if(platform)params.set("platform",platform);setLoading(true);const timer=setTimeout(()=>fetch(`/api/marketplace/products?${params}`,{signal:controller.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.message);setProducts(j.data.products)}).catch(e=>{if(e.name!=="AbortError")setError(e.message)}).finally(()=>setLoading(false)),250);return()=>{clearTimeout(timer);controller.abort()}},[keyword,platform]);
  return <section className="mt-8"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[15px] font-semibold">Market observations</h2><p className="mt-1 text-[13px]" style={{color:"var(--muted)"}}>Products observed on marketplaces from authorized feeds. Missing observations are never treated as out of stock.</p></div><div className="flex gap-2"><input aria-label="Search products" value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="Product, brand, category" className="rounded-lg border px-3 py-2 text-sm" style={{background:"var(--surface)",borderColor:"var(--border)"}}/><select aria-label="Platform" value={platform} onChange={e=>setPlatform(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{background:"var(--surface)",borderColor:"var(--border)"}}><option value="">All platforms</option><option>BLINKIT</option><option>ZEPTO</option><option>INSTAMART</option><option>AUTHORIZED_FEED</option></select></div></div>{error&&<p className="mb-3 text-sm text-red-500">{error}</p>}<div className="overflow-x-auto rounded-xl border" style={{borderColor:"var(--border)"}}><table className="w-full text-left text-sm"><thead style={{background:"var(--surface)",color:"var(--muted)"}}><tr>{["Product","Brand / category","Pack","Platform / city","Price / MRP","Availability","Last collected","Source"].map(h=><th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody>{products.map(p=><tr key={p.id} className="border-t" style={{borderColor:"var(--border)"}}><td className="min-w-72 px-4 py-3"><Link href={`/dashboard/products/${p.id}`} className="flex items-center gap-3 font-semibold hover:underline">{p.imageUrl?<img src={p.imageUrl} alt="" className="h-11 w-11 rounded object-cover"/>:<span className="h-11 w-11 rounded bg-gray-100"/>}{p.title}</Link></td><td className="px-4 py-3">{p.brand||"Unknown"}<div className="text-xs" style={{color:"var(--muted)"}}>{p.category||"Uncategorized"}</div></td><td className="whitespace-nowrap px-4 py-3">{p.packSize||"—"}</td><td className="px-4 py-3">{p.platform}<div className="text-xs" style={{color:"var(--muted)"}}>{p.currentPrice?.city||"—"}</div></td><td className="whitespace-nowrap px-4 py-3">{p.currentPrice?`₹${p.currentPrice.sellingPrice}`:"—"}<div className="text-xs" style={{color:"var(--muted)"}}>{p.currentPrice?.mrp?`MRP ₹${p.currentPrice.mrp}`:"MRP unavailable"}</div></td><td className="px-4 py-3">{p.currentAvailability?.availabilityStatus?.replaceAll("_"," ")||"UNKNOWN"}</td><td className="whitespace-nowrap px-4 py-3">{new Date(p.lastObservedAt).toLocaleString()}</td><td className="px-4 py-3"><a href={p.productUrl} target="_blank" rel="noreferrer" className="underline">Provenance</a></td></tr>)}</tbody></table>{loading&&<p className="p-8 text-center text-sm">Loading…</p>}{!loading&&!products.length&&<p className="p-8 text-center text-[13px]" style={{color:"var(--muted)"}}>No marketplace observations yet. Your own Blinkit catalog is listed above.</p>}</div></section>
}

interface Listing { id: string; itemId: string; productId: string | null; upc: string | null; name: string; brandName: string | null; uom: string | null; mrp: string | null; sellingPrice: string | null; status: string | null; businessCategory: string | null; sales: { units: number; gmv: number; lastOrder: string } | null }
const inr = (v: string | null) => (v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const off = (sp: string | null, mrp: string | null) => (sp && mrp && Number(mrp) > 0 ? `${Math.round((1 - Number(sp) / Number(mrp)) * 100)}% off` : null);

// The brand's own catalog as listed on connected seller panels (Blinkit).
function SellerCatalog() {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState("");
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { apiGet<{ brands: { id: string; name: string }[] }>("/api/brands").then((b) => { setBrands(b.brands); setBrandId(b.brands[0]?.id ?? ""); }).catch(() => setRows([])); }, []);
  useEffect(() => {
    if (!brandId) return;
    const t = setTimeout(() => apiGet<{ products: Listing[] }>(`/api/seller/products?brandId=${brandId}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) => setRows(r.products)).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [brandId, q]);
  const field = "rounded-lg border px-3 py-2 text-[13px]";
  const fieldStyle = { background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" };
  return (
    <section>
      <PageHeader title="Product catalog" subtitle="Your products as listed on connected seller panels, with live price, listing status and sales."
        actions={<>
          <input aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, item ID or UPC" className={field} style={fieldStyle} />
          {brands.length > 1 && <select aria-label="Brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} className={field} style={fieldStyle}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <Link href="/dashboard/seller/products" className="rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }}>All fields →</Link>
        </>} />
      <div className="overflow-x-auto rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full min-w-[960px] text-[13px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["Product", "Platform", "Item ID / UPC", "Pack", "Selling price", "MRP", "Listing status", "Category", "Units sold", "Sales"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-[12px] font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows?.map((p) => (
            <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="px-4 py-3 font-medium">{p.name}<div className="text-[12px] font-normal" style={{ color: "var(--muted)" }}>{p.brandName}</div></td>
              <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: "var(--blinkit)" }} />Blinkit</span></td>
              <td className="tnum px-4 py-3 text-[12px]">{p.itemId}<div style={{ color: "var(--muted)" }}>{p.upc ?? "—"}</div></td>
              <td className="px-4 py-3">{p.uom ?? "—"}</td>
              <td className="tnum px-4 py-3 font-medium">{inr(p.sellingPrice)}<div className="text-[12px] font-normal" style={{ color: "var(--muted)" }}>{off(p.sellingPrice, p.mrp) ?? ""}</div></td>
              <td className="tnum px-4 py-3">{inr(p.mrp)}</td>
              <td className="px-4 py-3">{p.status?.replaceAll("_", " ") ?? "—"}</td>
              <td className="px-4 py-3">{p.businessCategory ?? "—"}</td>
              <td className="tnum px-4 py-3">{p.sales ? p.sales.units.toLocaleString("en-IN") : "0"}</td>
              <td className="tnum px-4 py-3">{p.sales ? fmtINR(p.sales.gmv) : "—"}</td>
            </tr>))}</tbody>
        </table>
        {rows && !rows.length && <p className="p-8 text-center text-[13px]" style={{ color: "var(--muted)" }}>No products yet. <Link href="/dashboard/connections" className="font-semibold underline" style={{ color: "var(--accent)" }}>Connect Blinkit</Link> to pull your catalog.</p>}
        {!rows && <p className="p-8 text-center text-[13px]" style={{ color: "var(--muted)" }}>Loading…</p>}
      </div>
    </section>
  );
}

export default function ProductsPage() {
  return <><SellerCatalog /><MarketObservations /></>;
}
