"use client";
// Blinkit search SEO (Keyword Intelligence): blinkit.com results for the brand's Blinkit Ads keywords —
// organic vs ad rank, rating / price vs competitors, title words competitors use. Data: /api/seo/search.
import { Fragment, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { apiGet, ApiError } from "@/lib/client/api";

interface Own { rank: number; organicRank: number | null; name: string; productId: string; rating: number | null; ratingCount: number | null; price: number | null; mrp: number | null; isAd: boolean; campaign: string | null; soldOut: boolean }
interface Top { rank: number; brand: string | null; name: string; rating: number | null; ratingCount: number | null; price: number | null; isAd: boolean; isOwn: boolean }
interface Row {
  keyword: string; city: string; location: string | null; results: number; adsInTop10: number; own: Own[];
  bestOrganicRank: number | null; bestAdRank: number | null;
  ads: { spend: number; sales: number; roas: number | null; avgPosition: number | null } | null;
  competitors: { avgRating: number | null; medianRatingCount: number | null; medianPrice: number | null };
  top: Top[]; missingWords: { word: string; competitors: number }[]; tips: string[];
  coverage: { productId: string; name: string; live: number | null; closed: number | null; availabilityPct: number | null; listed: boolean; known: boolean }[];
}

const inr = (n: number | null | undefined) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const muted = { color: "var(--muted)" };
const rate = (r: number | null, c: number | null) => (r == null ? "—" : `${r}★${c != null ? ` (${c.toLocaleString("en-IN")})` : ""}`);

export function SearchSeo() {
  const [data, setData] = useState<{ snapshotDate: string | null; rows: Row[] } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { apiGet<{ snapshotDate: string | null; rows: Row[] }>("/api/seo/search").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load search SEO")); }, []);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!data) return <p className="py-8 text-center text-sm" style={muted}>Loading search SEO…</p>;
  if (!data.snapshotDate) return <Card title="Blinkit search SEO"><p className="text-xs" style={muted}>No search data yet. Use <b>Sync SEO now</b> above with "Include blinkit.com keyword search" ticked: it searches blinkit.com for your top Blinkit Ads keywords at the area you enter.</p></Card>;
  const th = "py-2 font-medium";
  return (
    <Card title="Blinkit search SEO (ad keywords)" subtitle={`blinkit.com search ${data.snapshotDate} · ${data.rows.length} keyword × city checks · organic = position ignoring ad cards`}>
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[1100px] text-[12px] [&_td]:px-2 [&_th]:px-2">
        <thead><tr style={muted}>{["Keyword", "City", "Organic rank", "Ad rank", "Your product", "Rating", "Competitors' rating", "Price vs median", "Ads (30d)", "Ads in top 10"].map((h, i) => <th key={h} className={`${th} ${i < 2 || i === 4 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
        <tbody>{data.rows.map((r) => {
          const id = `${r.keyword}|${r.city}`, best = r.own[0];
          return <Fragment key={id}>
            <tr className="cursor-pointer border-t" style={{ borderColor: "var(--border)" }} onClick={() => setOpen(open === id ? null : id)}>
              <td className="py-1.5 font-semibold"><span className="mr-1" style={muted}>{open === id ? "▾" : "▸"}</span>{r.keyword}</td>
              <td>{r.city}</td>
              <td className="tnum text-right font-semibold" style={{ color: r.bestOrganicRank == null ? "var(--crit)" : r.bestOrganicRank > 10 ? "var(--warn)" : undefined }}>{r.bestOrganicRank ?? `>${r.results}`}</td>
              <td className="tnum text-right">{r.bestAdRank ?? "—"}</td>
              <td className="max-w-[220px] truncate" title={best?.name}>{best ? best.name : <span style={muted}>not in results</span>}</td>
              <td className="tnum text-right">{best ? rate(best.rating, best.ratingCount) : "—"}</td>
              <td className="tnum text-right">{r.competitors.avgRating == null ? "—" : `${r.competitors.avgRating.toFixed(1)}★ (${(r.competitors.medianRatingCount ?? 0).toLocaleString("en-IN")})`}</td>
              <td className="tnum text-right">{best?.price != null ? `${inr(best.price)} / ${inr(r.competitors.medianPrice)}` : inr(r.competitors.medianPrice)}</td>
              <td className="tnum text-right">{r.ads ? `${inr(r.ads.sales)} · ${r.ads.roas == null ? "—" : r.ads.roas.toFixed(1) + "x"}` : "—"}</td>
              <td className="tnum text-right">{r.adsInTop10}</td>
            </tr>
            {open === id && <tr><td colSpan={10}><div className="grid gap-4 py-3 lg:grid-cols-2">
              <div className="space-y-2 text-xs">
                <h4 className="font-semibold">What to fix</h4>
                {r.tips.length ? <ul className="list-disc space-y-1 pl-4">{r.tips.map((t) => <li key={t}>{t}</li>)}</ul> : <p style={muted}>Looks healthy.</p>}
                {r.missingWords.length > 0 && <p><b>Words in the top organic titles that yours don't use</b> <span style={muted}>(for reference: only the relevant ones belong in your title)</span>: {r.missingWords.map((m) => `${m.word} (${m.competitors})`).join(", ")}</p>}
                {r.coverage.length > 0 && <div><h4 className="mt-2 font-semibold">Advertised products in {r.city} (Seller Hub)</h4>{r.coverage.map((c) => <p key={c.productId}>{c.name}: {!c.known ? "no Seller Hub data" : !c.listed ? <span style={{ color: "var(--crit)" }}>not served in this city</span> : <>{c.live ?? 0} live / {c.closed ?? 0} closed stores · availability {c.availabilityPct ?? "—"}%</>}</p>)}</div>}
                {r.own.length > 0 && <div><h4 className="mt-2 font-semibold">Your cards</h4>{r.own.map((o) => <p key={o.productId + o.rank}>#{o.rank}{o.organicRank ? ` (organic ${o.organicRank})` : ""} {o.isAd ? <b>AD{o.campaign ? ` · ${o.campaign}` : ""}</b> : null} — {o.name} · {rate(o.rating, o.ratingCount)} · {inr(o.price)}{o.mrp && o.price && o.mrp > o.price ? ` (MRP ${inr(o.mrp)})` : ""}{o.soldOut ? " · sold out" : ""}</p>)}</div>}
                {r.location && <p style={muted}>Location: {r.location}</p>}
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold">Top results</h4>
                <table className="w-full text-[11px]"><thead><tr style={muted}><th className="py-1 text-left font-medium">#</th><th className="text-left font-medium">Product</th><th className="text-right font-medium">Rating</th><th className="text-right font-medium">Price</th></tr></thead>
                  <tbody>{r.top.map((t) => <tr key={t.rank} className="border-t" style={{ borderColor: "var(--border)", fontWeight: t.isOwn ? 600 : undefined }}><td className="py-1">{t.rank}{t.isAd ? <span className="ml-1 rounded px-1 text-[9px]" style={{ background: "var(--border)" }}>AD</span> : null}</td><td>{t.name}</td><td className="tnum text-right">{rate(t.rating, t.ratingCount)}</td><td className="tnum text-right">{inr(t.price)}</td></tr>)}</tbody></table>
              </div>
            </div></td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>
    </Card>
  );
}
