"use client";
// Shared frame for the Blinkit Ads pages: brand picker, wallet, connection status,
// Sync now, tabs and the date filter (default: last 30 synced days).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import SyncProgress from "@/components/SyncProgress";
import { PageHeader } from "@/components/PageHeader";
import { DateRangeFilter, type DateSelection } from "@/components/seller/DateRangeFilter";
import { field, fieldStyle, Empty } from "@/components/seller/SellerShell";

export interface AdsMeta {
  from: string | null; to: string | null; days: number;
  account: { advertiserName: string | null; snapshotDate: string; walletBalance: number | null; tentativeSpend: number | null; creditBalance: number | null } | null;
  campaigns: { total: number; active: number };
  connection: { id: string; status: string; lastVerifiedAt: string | null; lastError: string | null } | null;
}
export interface Metrics { spend: number; impressions: number; sales: number; atc: number; directAtc: number; indirectAtc: number; directSales: number; indirectSales: number; qty: number; newUsers: number; roas: number | null; directRoas: number | null; cpm: number | null; ctr: number | null; costPerAtc: number | null; atcRate: number | null; acos: number | null }
export interface AdsCtx { brandId: string; meta: AdsMeta; version: number; dates: DateSelection; query: string }

const TABS = [
  { href: "/dashboard/ads", label: "Overview" },
  { href: "/dashboard/ads/campaigns", label: "Campaigns" },
  { href: "/dashboard/ads/keywords", label: "Keywords" },
  { href: "/dashboard/ads/bids", label: "Bids" },
  { href: "/dashboard/ads/insights", label: "Account & insights" },
  { href: "/dashboard/ads/growth", label: "Growth plan" },
];
export const inr = (n: number | null | undefined) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));

function defaultRange(meta: AdsMeta) {
  const to = meta.to ?? new Date().toISOString().slice(0, 10);
  const fromLimit = meta.from ?? to;
  const d = new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29);
  const from = d.toISOString().slice(0, 10) < fromLimit ? fromLimit : d.toISOString().slice(0, 10);
  return { from, to };
}

export function AdsShell({ title, subtitle, children, dated = true, allowEmpty = false }: {
  title: string; subtitle: string; dated?: boolean; allowEmpty?: boolean; children: (ctx: AdsCtx) => React.ReactNode;
}) {
  const path = usePathname();
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState("");
  const [meta, setMeta] = useState<AdsMeta | null>(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncSince, setSyncSince] = useState(0);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dates, setDates] = useState<DateSelection | null>(null);

  useEffect(() => {
    apiGet<{ brands: { id: string; name: string }[] }>("/api/brands").then((b) => {
      setBrands(b.brands);
      const saved = localStorage.getItem("qcp-seller-brand");
      setBrandId(b.brands.find((x) => x.id === saved)?.id ?? b.brands[0]?.id ?? "");
    }).catch(() => setNote({ kind: "err", text: "Could not load brands" }));
  }, []);

  const loadMeta = useCallback(async () => {
    if (!brandId) return null;
    const m = await apiGet<AdsMeta>(`/api/ads/meta?brandId=${brandId}`).catch(() => null);
    setMeta(m);
    return m;
  }, [brandId]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const available = useMemo(() => meta ? { from: meta.from ?? defaultRange(meta).from, to: meta.to ?? defaultRange(meta).to } : null, [meta]);
  useEffect(() => { if (meta) setDates({ range: defaultRange(meta), preset: "custom", compare: false, comparison: null }); }, [meta?.from, meta?.to, brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSyncFinished = useCallback(async (ok: boolean) => {
    const m = await loadMeta();
    setVersion((v) => v + 1);
    setNote(ok ? { kind: "ok", text: m?.connection?.lastError ? `Sync finished. ${m.connection.lastError}` : "Sync complete. Ad data updated." } : { kind: "err", text: m?.connection?.lastError ?? "Sync failed." });
  }, [loadMeta]);

  async function syncNow() {
    if (!meta?.connection) return;
    setNote(null); setSyncSince(Date.now()); setSyncing(true);
    try { await apiPost(`/api/connections/${meta.connection.id}/sync`); }
    catch (e) { setSyncing(false); setNote({ kind: "err", text: e instanceof ApiError ? e.message : "Could not start sync" }); }
  }

  const c = meta?.connection;
  const a = meta?.account;
  const query = dates ? `brandId=${brandId}&from=${dates.range.from}&to=${dates.range.to}` : `brandId=${brandId}`;
  return (
    <div>
      <PageHeader eyebrow="Blinkit Ads · brands.blinkit.com" title={title} subtitle={subtitle} actions={<>
        <select aria-label="Brand" className={field} style={fieldStyle} value={brandId} onChange={(e) => { setBrandId(e.target.value); localStorage.setItem("qcp-seller-brand", e.target.value); }}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {c?.status === "CONNECTED" ? (
          <button onClick={syncNow} disabled={syncing} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }}>
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{syncing ? "Syncing…" : "Sync now"}
          </button>
        ) : (
          <Link href="/dashboard/connections" className="rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }}>
            {c?.status === "ERROR" ? "Reconnect Blinkit Ads" : "Connect Blinkit Ads"}
          </Link>
        )}
      </>} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
        {a && <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}><Wallet size={14} />Ads wallet {inr(a.walletBalance)}{a.creditBalance ? ` · credit ${inr(a.creditBalance)}` : ""}</span>}
        {a?.advertiserName && <span>{a.advertiserName}</span>}
        {meta && <span>{meta.campaigns.active} active of {meta.campaigns.total} campaigns</span>}
        <span>{c?.status === "CONNECTED" ? `Connected · last sync ${c.lastVerifiedAt ? new Date(c.lastVerifiedAt).toLocaleString() : "pending"}` : c?.status === "ERROR" ? (c.lastError ?? "Needs reconnect") : meta?.from ? "Imported by the local agent (blinkit_ads_sync) · connect Blinkit Ads for one-click Sync now" : "Blinkit Ads is not connected for this brand."}</span>
        {meta?.from && <span>data {meta.from} – {meta.to}</span>}
      </div>
      {syncing && c && (
        <div className="mt-3 rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="mb-2 flex justify-end"><button onClick={() => setSyncing(false)} className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Hide ✕</button></div>
          <SyncProgress connectionId={c.id} since={syncSince} onFinished={onSyncFinished} />
        </div>
      )}
      {note && <p className="mt-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: note.kind === "ok" ? "var(--border)" : "var(--crit)", color: note.kind === "ok" ? "var(--ink)" : "var(--crit)" }}>{note.text}</p>}
      <nav className="mt-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} aria-label="Blinkit Ads">
        {TABS.map((t) => {
          const active = t.href === "/dashboard/ads" ? path === t.href : path.startsWith(t.href);
          return <Link key={t.href} href={t.href} className="-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold"
            style={{ borderColor: active ? "var(--accent)" : "transparent", color: active ? "var(--ink)" : "var(--muted)" }}>{t.label}</Link>;
        })}
      </nav>
      {dated && dates && available && meta?.from && <div className="mt-4"><DateRangeFilter value={dates} available={available} onChange={setDates} allowCompare={false} /></div>}
      <div className="mt-5">
        {!brandId || !meta || !dates ? <p className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
          : !allowEmpty && !meta.from && !meta.account ? <Empty text="No Blinkit Ads data yet. Connect Blinkit Ads under Connections (log in with the sign-in link Blinkit emails you), then press Sync now." />
          : children({ brandId, meta, version, dates, query })}
      </div>
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[12px]" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="tnum mt-1 text-xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

export const roasText = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}x`);
export const pctText = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);

export function StatusPill({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "var(--good)" : status === "STOPPED" ? "var(--crit)" : "var(--muted)";
  return <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: tone, color: "var(--ink)" }}>
    <i className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />{status}
  </span>;
}

export const TYPE_LABEL: Record<string, string> = {
  PRODUCT_LISTING: "Product Booster (search)", PRODUCT_RECOMMENDATION: "Recommendation Ads", BANNER_LISTING: "Banner Listing",
  SHELF_DIY: "Shelf", PRODUCT_INJECTION_DIY: "Product Injection", STORY_DIY: "Story", BANNER_DIY: "Banner", BRAND_SPOTLIGHT_DIY: "Brand Spotlight", BRAND_BOOSTER: "Brand Booster",
};
