"use client";
// Blinkit Ads → Bids: every keyword bid per campaign (filter by product), propose new bids,
// approve them (Owner / Org Admin), and the server's Blinkit Ads session applies them.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdsShell, inr, roasText, StatusPill, type AdsCtx } from "@/components/ads/AdsShell";
import { field, fieldStyle } from "@/components/seller/SellerShell";
import { Card } from "@/components/Card";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import { fmtN } from "@/lib/format";

type Status = "PENDING" | "APPROVED" | "APPLYING" | "APPLIED" | "CONFLICT" | "FAILED" | "REJECTED" | "CANCELLED";
interface Change { id: string; campaignId: string; campaignName: string; keyword: string; matchType: string; fromCpm: number | null; toCpm: number; status: Status; note: string | null; createdBy: string; decidedBy: string | null; decidedAt: string | null; appliedAt: string | null; beforeCpm: number | null; afterCpm: number | null; error: string | null; createdAt: string; updatedAt: string }
interface Perf { impressions: number; spend: number; sales: number; atc: number; position: number | null; roas: number | null }
interface Bid { matchType: string; cpm: number | null; maxBoost: number | null; perf: Perf | null; open: Change | null; last: Change | null }
interface Campaign { campaignId: string; name: string; type: string; status: string; budget: number | null; syncedAt: string; products: { productId: string; name: string | null }[]; keywords: { keyword: string; bids: Bid[] }[] }
interface BidsData { range: { from: string; to: string } | null; limits: { min: number; max: number; perDay?: number; perKeywordPerDay?: number; usedToday?: number }; connection?: { status: string; paused: string | null } | null; products: { productId: string; name: string | null }[]; campaigns: Campaign[] }
interface Recommendation { id: string; campaignId: string; campaignName: string; keyword: string; matchType: string; cpm: number; toCpm: number; changePct: number; objective: string; reason: string; expectedImpact: string; decisionFactors: string[]; confidence: string; spend: number; sales: number; roas: number | null; research?: { dataWarnings: string[] }; agentConsensus?: { verdict: "approve" | "review" | "skip"; summary: string; reviews: { role: string; verdict: string; summary: string; risks: string[] }[] } }
interface RecommendationData { recommendations: Recommendation[]; mode: string; model: string | null; range: { from: string; to: string } | null; generatedAt: string }

const muted = { color: "var(--muted)" };
const STATUS_COLOR: Record<Status, string> = {
  PENDING: "var(--warn)", APPROVED: "var(--accent)", APPLYING: "var(--accent)", APPLIED: "var(--ok, #1baf7a)",
  CONFLICT: "var(--crit)", FAILED: "var(--crit)", REJECTED: "var(--muted)", CANCELLED: "var(--muted)",
};
const STATUS_TEXT: Record<Status, string> = {
  PENDING: "Waiting for approval", APPROVED: "Approved · queued", APPLYING: "Applying on Blinkit…", APPLIED: "Applied",
  CONFLICT: "Not applied: changed in Blinkit", FAILED: "Failed", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
const key = (c: string, k: string, m: string) => `${c}|${k.toLowerCase()}|${m}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function Chip({ c }: { c: Change }) {
  return <span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: STATUS_COLOR[c.status], color: STATUS_COLOR[c.status] }}
    title={c.error ?? undefined}>{STATUS_TEXT[c.status]} · ₹{c.fromCpm ?? "?"}→₹{c.toCpm}</span>;
}

function BidsView({ brandId, query, version }: AdsCtx) {
  const [data, setData] = useState<BidsData | null>(null);
  const [history, setHistory] = useState<Change[]>([]);
  const [analysis, setAnalysis] = useState<RecommendationData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [product, setProduct] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams(query);
    if (product) p.set("productId", product);
    if (activeOnly) p.set("active", "1");
    try {
      const [b, h, a] = await Promise.all([apiGet<BidsData>(`/api/ads/bids?${p}`), apiGet<{ changes: Change[] }>(`/api/ads/bids/changes?brandId=${brandId}`), apiGet<RecommendationData>(`/api/ads/bids/recommendations?${query}`)]);
      setData(b); setHistory(h.changes); setAnalysis(a); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not load bids"); }
  }, [query, product, activeOnly, brandId]);
  useEffect(() => { load(); }, [load, version]);

  const pending = history.filter((c) => c.status === "PENDING");
  const inFlight = history.some((c) => c.status === "APPROVED" || c.status === "APPLYING");
  useEffect(() => { // follow approved changes until Blinkit confirms them
    if (!inFlight) return;
    const refreshApplyStatus = async () => {
      const p = new URLSearchParams(query); if (product) p.set("productId", product); if (activeOnly) p.set("active", "1");
      try { const [b, h] = await Promise.all([apiGet<BidsData>(`/api/ads/bids?${p}`), apiGet<{ changes: Change[] }>(`/api/ads/bids/changes?brandId=${brandId}`)]); setData(b); setHistory(h.changes); } catch { /* main load surfaces errors */ }
    };
    const t = setInterval(refreshApplyStatus, 5000);
    return () => clearInterval(t);
  }, [inFlight, query, product, activeOnly, brandId]);

  const campaigns = useMemo(() => (data?.campaigns ?? []).map((c) => ({
    ...c, keywords: c.keywords.filter((k) => !search || k.keyword.toLowerCase().includes(search.toLowerCase())),
  })).filter((c) => c.keywords.length), [data, search]);
  const limits = data?.limits ?? { min: 50, max: 2000 };

  const recommendations = analysis?.recommendations ?? [];

  const useRecommendations = () => setEdits((old) => ({ ...old, ...Object.fromEntries(recommendations.filter((item) => item.agentConsensus?.verdict === "approve").map((item) => [item.id, String(item.toCpm)])) }));

  const changes = useMemo(() => Object.entries(edits).flatMap(([k, v]) => {
    const [campaignId, keyword, matchType] = k.split("|");
    const camp = data?.campaigns.find((c) => c.campaignId === campaignId);
    const kw = camp?.keywords.find((x) => x.keyword.toLowerCase() === keyword);
    const bid = kw?.bids.find((b) => b.matchType === matchType);
    const to = Number(v);
    if (!v.trim() || !kw || !bid || !Number.isFinite(to) || to === bid.cpm) return [];
    const recommendation = recommendations.find((item) => item.id === k);
    return [{ campaignId, keyword: kw.keyword, matchType, toCpm: Math.round(to), from: bid.cpm, campaign: camp!.name, recommendation }];
  }), [edits, data, recommendations]);
  const invalid = changes.filter((c) => c.toCpm < limits.min || c.toCpm > limits.max || (c.from != null && Math.abs(c.toCpm - c.from) / c.from > .15));

  const submit = async () => {
    setBusy(true); setNotice(""); setError("");
    try {
      const r = await apiPost<{ created: number; replaced: number }>(`/api/ads/bids/changes?brandId=${brandId}`, { changes: changes.map(({ campaignId, keyword, matchType, toCpm, recommendation }) => ({ campaignId, keyword, matchType, toCpm, ...(recommendation ? { note: `${recommendation.objective}: ${recommendation.reason}`.slice(0, 300), evidence: recommendation, dataAsOf: analysis?.range?.to, model: analysis?.model, promptVersion: "bid-v1" } : {}) })) });
      setEdits({}); setNotice(`${r.created} bid change(s) sent for approval.`); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not submit"); } finally { setBusy(false); }
  };
  const decide = async (ids: string[], action: "approve" | "reject" | "retry" | "cancel") => {
    if (!ids.length) return;
    const list = history.filter((c) => ids.includes(c.id));
    if (action === "approve" && !window.confirm(`Apply ${ids.length} bid change(s) on Blinkit Ads now?\n\n${list.slice(0, 12).map((c) => `• ${c.keyword} (${c.matchType}) in ${c.campaignName}: ₹${c.fromCpm ?? "?"} → ₹${c.toCpm}`).join("\n")}${list.length > 12 ? `\n…and ${list.length - 12} more` : ""}`)) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const r = await apiPost<{ updated: number; apply: boolean }>(`/api/ads/bids/changes/decide?brandId=${brandId}`, { ids, action });
      setSelected(new Set());
      setNotice(r.apply ? `${r.updated} change(s) approved: applying on Blinkit Ads…` : `${r.updated} change(s) ${action === "reject" ? "rejected" : action === "cancel" ? "cancelled" : "updated"}.`);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not update"); } finally { setBusy(false); }
  };

  if (error && !data) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!data) return <p className="py-8 text-center text-sm" style={muted}>Loading…</p>;
  const productName = (id: string) => data.products.find((p) => p.productId === id)?.name ?? `Product ${id}`;
  const totalBids = campaigns.reduce((n, c) => n + c.keywords.reduce((m, k) => m + k.bids.length, 0), 0);

  return (
    <div className="space-y-4 pb-20">
      {data.connection?.paused && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--crit)", color: "var(--crit)" }}>{data.connection.paused} Approved bids wait until then.</p>}
      {data.connection && data.connection.status !== "CONNECTED" && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)" }}>Blinkit Ads is {data.connection.status.toLowerCase()}: approved bids cannot be applied until you <a className="underline" href="/dashboard/connections">reconnect Blinkit Ads</a>.</p>}
      {notice && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--accent)" }}>{notice}</p>}
      {error && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--crit)", color: "var(--crit)" }}>{error}</p>}

      <Card title={`AI bid recommendations · ${recommendations.length}`} subtitle={`Performance + Growth + Risk agents reviewed deterministic ±15% safe bids${analysis?.range ? ` using ${analysis.range.from}–${analysis.range.to}` : ""}. Nothing changes until approval.`}
        right={recommendations.some((item) => item.agentConsensus?.verdict === "approve") ? <button className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }} onClick={useRecommendations}>Add agent-approved bids</button> : null}>
        {!recommendations.length ? <p className="py-3 text-xs" style={muted}>No safe bid change found. Keep bids unchanged until more performance data arrives.</p> :
          <div className="mt-2 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">{recommendations.slice(0, 9).map((item) => <div key={item.id} className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start justify-between gap-2"><div><b>{item.objective}</b><p className="mt-0.5 font-semibold">{item.keyword} · {item.matchType.toLowerCase()}</p></div><div className="text-right"><b className="tnum whitespace-nowrap" style={{ color: item.toCpm > item.cpm ? "var(--ok)" : "var(--warn)" }}>₹{item.cpm} → ₹{item.toCpm}</b><p className="tnum text-[10px]" style={muted}>{item.changePct > 0 ? "+" : ""}{item.changePct.toFixed(0)}%</p></div></div>
            <div className="mt-2 flex flex-wrap gap-1">{item.decisionFactors.map((factor) => <span key={factor} className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{factor}</span>)}</div>
            <p className="mt-2"><b>Why:</b> <span style={muted}>{item.reason}</span></p><p className="mt-1"><b>Expected impact:</b> {item.expectedImpact}</p><p className="mt-1"><b>Agent review:</b> <span style={muted}>{item.agentConsensus?.summary ?? "Manual review required."}</span></p>{item.agentConsensus?.reviews?.length ? <details className="mt-2"><summary className="cursor-pointer font-semibold">Performance, Growth and Risk reviews</summary>{item.agentConsensus.reviews.map((review) => <div key={review.role} className="mt-1 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}><b>{review.role} · {review.verdict}</b><p style={muted}>{review.summary}</p>{review.risks.map((risk) => <p key={risk} style={{ color: "var(--warn)" }}>• {risk}</p>)}</div>)}</details> : null}{item.research?.dataWarnings.map((warning) => <p key={warning} className="mt-1" style={{ color: "var(--warn)" }}>• {warning}</p>)}<p className="mt-1 truncate" style={muted}>{item.campaignName} · confidence {item.confidence}</p>
            <button disabled={item.agentConsensus?.verdict !== "approve"} className="mt-2 font-semibold underline disabled:no-underline disabled:opacity-50" onClick={() => setEdits((old) => ({ ...old, [item.id]: String(item.toCpm) }))}>{item.agentConsensus?.verdict === "approve" ? "Add for approval" : "Blocked by agent review"}</button>
          </div>)}</div>}
      </Card>

      {pending.length > 0 && <Card title={`${pending.length} bid change(s) waiting for approval`} subtitle="Approving applies them on Blinkit Ads from the server. Each bid is re-checked first: if it was changed in Blinkit meanwhile, it is not overwritten."
        right={<div className="flex gap-2">
          <button className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--plane)" }} disabled={busy}
            onClick={() => decide(selected.size ? [...selected] : pending.map((c) => c.id), "approve")}>Approve {selected.size ? `${selected.size} selected` : "all"}</button>
          <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }} disabled={busy || !selected.size}
            onClick={() => decide([...selected], "reject")}>Reject selected</button>
        </div>}>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[820px] text-[12px] [&_td]:px-2 [&_th]:px-2">
          <thead><tr style={muted}>{["", "Keyword", "Match", "Campaign", "Current", "New", "Change", "Proposed by", ""].map((h, i) => <th key={i} className={`py-2 font-medium ${["Current", "New", "Change"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody>{pending.map((c) => {
            const diff = c.fromCpm ? (c.toCpm - c.fromCpm) / c.fromCpm : null;
            return <tr key={c.id} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td><input type="checkbox" aria-label={`Select ${c.keyword}`} checked={selected.has(c.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} /></td>
              <td className="py-1.5 font-semibold">{c.keyword}</td><td className="text-[11px]">{c.matchType.toLowerCase()}</td><td className="max-w-[220px] truncate" title={c.campaignName}>{c.campaignName}</td>
              <td className="tnum text-right">{inr(c.fromCpm)}</td><td className="tnum text-right font-semibold">{inr(c.toCpm)}</td>
              <td className="tnum text-right" style={{ color: diff == null ? undefined : diff > 0 ? "var(--warn)" : "var(--ok, #1baf7a)" }}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(0)}%`}</td>
              <td className="text-[11px]" style={muted}>{c.createdBy} · {when(c.createdAt)}</td>
              <td><button className="text-[11px] underline" onClick={() => decide([c.id], "cancel")} disabled={busy}>Withdraw</button></td>
            </tr>;
          })}</tbody>
        </table></div>
      </Card>}

      <Card title={`Keyword bids · ${totalBids}`} subtitle={`CPM bid per keyword and match type in each campaign${data.range ? `; performance ${data.range.from} → ${data.range.to}` : ""}. Type a new CPM (₹${limits.min}–₹${limits.max}) and send it for approval. Account safety: ${limits.usedToday ?? 0}/${limits.perDay ?? "–"} changes today, max ${limits.perKeywordPerDay ?? "–"} per keyword a day.`}
        right={<div className="flex flex-wrap items-center justify-end gap-2">
          <select className={field} style={{ ...fieldStyle, maxWidth: 280 }} value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Filter by product">
            <option value="">All products</option>{data.products.map((p) => <option key={p.productId} value={p.productId}>{p.name ?? `Product ${p.productId}`}</option>)}
          </select>
          <input className={field} style={fieldStyle} placeholder="Search keyword" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search keyword" />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active campaigns only</label>
        </div>}>
        {!campaigns.length ? <p className="py-6 text-center text-xs" style={muted}>No keyword bids{product ? " for this product" : ""}{activeOnly ? " in active campaigns" : ""}. Sync Blinkit Ads on the Connections page to load bids.</p> :
          <div className="mt-2 space-y-5">{campaigns.map((c) => <div key={c.campaignId}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
              <a className="font-semibold underline-offset-2 hover:underline" href={`/dashboard/ads/campaigns/${c.campaignId}`}>{c.name}</a><StatusPill status={c.status} />
              <span style={muted}>budget {inr(c.budget)} · {c.products.map((p) => p.name ?? productName(p.productId)).join(", ") || "no products"} · synced {when(c.syncedAt)}</span>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-[12px] [&_td]:px-2 [&_th]:px-2">
              <thead><tr style={muted}>{["Keyword", "Match", "Current CPM", "Impressions", "Spend", "Sales", "ROAS", "Avg slot", "New CPM", "Status"].map((h) => <th key={h} className={`py-1.5 font-medium ${["Keyword", "Match", "Status"].includes(h) ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
              <tbody>{c.keywords.flatMap((k) => k.bids.map((b) => {
                const id = key(c.campaignId, k.keyword, b.matchType), v = edits[id] ?? "";
                const bad = v !== "" && (Number(v) < limits.min || Number(v) > limits.max);
                const locked = b.open && b.open.status !== "PENDING";
                return <tr key={id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5 font-semibold">{k.keyword}</td><td className="text-[11px]">{b.matchType.toLowerCase()}{b.maxBoost ? ` · boost ${Math.round(b.maxBoost * 100)}%` : ""}</td>
                  <td className="tnum text-right font-semibold">{inr(b.cpm)}</td>
                  <td className="tnum text-right">{b.perf ? fmtN(b.perf.impressions) : "—"}</td><td className="tnum text-right">{inr(b.perf?.spend)}</td>
                  <td className="tnum text-right">{inr(b.perf?.sales)}</td><td className="tnum text-right">{roasText(b.perf?.roas)}</td>
                  <td className="tnum text-right">{b.perf?.position != null ? b.perf.position.toFixed(1) : "—"}</td>
                  <td className="text-right"><input type="number" inputMode="numeric" min={limits.min} max={limits.max} step={10} disabled={!!locked}
                    className={`${field} w-24 text-right`} style={{ ...fieldStyle, borderColor: bad ? "var(--crit)" : undefined }} placeholder={b.cpm != null ? String(b.cpm) : ""}
                    value={v} onChange={(e) => setEdits((s) => ({ ...s, [id]: e.target.value }))} aria-label={`New CPM for ${k.keyword} ${b.matchType}`} /></td>
                  <td>{b.open ? <Chip c={b.open} /> : b.last ? <Chip c={b.last} /> : null}</td>
                </tr>;
              }))}</tbody>
            </table></div>
          </div>)}</div>}
      </Card>

      <Card title="Bid change history" subtitle="Every proposal, approval and what Blinkit reported before and after applying.">
        {!history.length ? <p className="py-4 text-xs" style={muted}>No bid changes yet.</p> :
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[980px] text-[12px] [&_td]:px-2 [&_th]:px-2">
            <thead><tr style={muted}>{["When", "Keyword", "Campaign", "Change", "Status", "Blinkit before → after", "Who", ""].map((h, i) => <th key={i} className="py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{history.slice(0, 100).map((c) => <tr key={c.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5 whitespace-nowrap" style={muted}>{when(c.appliedAt ?? c.decidedAt ?? c.createdAt)}</td>
              <td className="font-semibold">{c.keyword} <span className="text-[10px] font-normal" style={muted}>{c.matchType.toLowerCase()}</span></td>
              <td className="max-w-[200px] truncate" title={c.campaignName}>{c.campaignName}</td>
              <td className="tnum whitespace-nowrap">₹{c.fromCpm ?? "?"} → ₹{c.toCpm}</td>
              <td><span className="font-semibold" style={{ color: STATUS_COLOR[c.status] }}>{STATUS_TEXT[c.status]}</span>{c.error && <div className="max-w-[320px] text-[11px]" style={muted}>{c.error}</div>}</td>
              <td className="tnum">{c.beforeCpm == null && c.afterCpm == null ? "—" : c.afterCpm == null ? `₹${c.beforeCpm} (unchanged)` : `₹${c.beforeCpm ?? "?"} → ₹${c.afterCpm}`}</td>
              <td className="text-[11px]" style={muted}>{c.createdBy}{c.decidedBy ? ` · ${c.status === "REJECTED" ? "rejected" : c.status === "CANCELLED" ? "withdrawn" : "approved"} by ${c.decidedBy}` : ""}</td>
              <td>{c.status === "FAILED" && <button className="text-[11px] underline" disabled={busy} onClick={() => decide([c.id], "retry")}>Retry</button>}</td>
            </tr>)}</tbody>
          </table></div>}
      </Card>

      {changes.length > 0 && <div className="fixed inset-x-0 bottom-0 z-40 border-t px-6 py-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 text-xs">
          <b>{changes.length} bid change(s) ready</b>
          <span style={muted}>{changes.slice(0, 4).map((c) => `${c.keyword} ₹${c.from ?? "?"}→₹${c.toCpm}`).join(" · ")}{changes.length > 4 ? " …" : ""}</span>
          {invalid.length > 0 && <span style={{ color: "var(--crit)" }}>{invalid.length} outside ₹{limits.min}–₹{limits.max} or over 15%</span>}
          <span className="ml-auto" />
          <button className="rounded-lg border px-3 py-1.5 font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => setEdits({})} disabled={busy}>Clear</button>
          <button className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--plane)" }} disabled={busy || invalid.length > 0} onClick={submit}>Submit for approval</button>
        </div>
      </div>}
    </div>
  );
}

export default function AdsBidsPage() {
  return <AdsShell title="Bids" subtitle="Every Blinkit Ads keyword bid. Changes need approval, then they are applied on Blinkit Ads.">{(ctx) => <BidsView {...ctx} />}</AdsShell>;
}
