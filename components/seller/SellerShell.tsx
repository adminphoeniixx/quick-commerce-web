"use client";
// Shared frame for the seller-data pages: brand picker, tabs, connection status and Sync now.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import SyncProgress from "@/components/SyncProgress";
import { PageHeader } from "@/components/PageHeader";
import { PlatformSelector } from "./PlatformSelector";
import { platformName } from "@/lib/platforms";

export interface SellerMeta {
  from: string | null; to: string | null; orderLines: number;
  connection: { id: string; status: string; lastVerifiedAt: string | null; lastError: string | null } | null;
}

const TABS = [
  { href: "/dashboard/seller/sales", label: "Sales analysis" },
  { href: "/dashboard/seller/orders", label: "Orders" },
  { href: "/dashboard/seller/products", label: "Products" },
  { href: "/dashboard/seller/inventory", label: "Inventory" },
  { href: "/dashboard/seller/reports", label: "Synced reports" },
];

export const field = "rounded-[9px] border px-3 py-2 text-[13px]";
export const fieldStyle = { borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" };

export function SellerShell({ title, subtitle, children }: {
  title: string; subtitle: string;
  children: (ctx: { brandId: string; platform: string; meta: SellerMeta; version: number }) => React.ReactNode;
}) {
  const path = usePathname();
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState("");
  const [platform, setPlatform] = useState("blinkit");
  const [meta, setMeta] = useState<SellerMeta | null>(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncSince, setSyncSince] = useState(0);
  const [syncDone, setSyncDone] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const savedPlatform = typeof window !== "undefined" ? localStorage.getItem("qcp-seller-platform") : null;
    if (savedPlatform) setPlatform(savedPlatform);
    apiGet<{ brands: { id: string; name: string }[] }>("/api/brands").then((b) => {
      setBrands(b.brands);
      const saved = typeof window !== "undefined" ? localStorage.getItem("qcp-seller-brand") : null;
      setBrandId(b.brands.find((x) => x.id === saved)?.id ?? b.brands[0]?.id ?? "");
    }).catch(() => setNote({ kind: "err", text: "Could not load brands" }));
  }, []);

  const loadMeta = useCallback(async () => {
    if (!brandId) return;
    try { setMeta(await apiGet<SellerMeta>(`/api/seller/meta?brandId=${brandId}&platform=${platform}`)); } catch { setMeta(null); }
  }, [brandId, platform]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // When the live progress panel reports completion, reload meta + page data.
  const onSyncFinished = useCallback(async (ok: boolean) => {
    const m = await apiGet<SellerMeta>(`/api/seller/meta?brandId=${brandId}&platform=${platform}`).catch(() => null);
    if (m) setMeta(m);
    setSyncDone(true);
    setVersion((v) => v + 1);
    setNote(ok ? { kind: "ok", text: m?.connection?.lastError ? `Sync finished. ${m.connection.lastError}` : "Sync complete. Data updated." } : { kind: "err", text: m?.connection?.lastError ?? "Sync failed. See Synced reports for details." });
  }, [brandId, platform]);

  async function syncNow() {
    if (!meta?.connection) return;
    setNote(null); setSyncDone(false); setSyncSince(Date.now()); setSyncing(true);
    try { await apiPost(`/api/connections/${meta.connection.id}/sync`); }
    catch (e) { setSyncing(false); setNote({ kind: "err", text: e instanceof ApiError ? e.message : "Could not start sync" }); }
  }

  const c = meta?.connection;
  return (
    <div>
        <PageHeader eyebrow={`${platformName(platform)} seller data`} title={title} subtitle={subtitle} actions={<>
          <select aria-label="Brand" className={field} style={fieldStyle} value={brandId} onChange={(e) => { setBrandId(e.target.value); localStorage.setItem("qcp-seller-brand", e.target.value); }}>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {c?.status === "CONNECTED" ? (
            <button onClick={syncNow} disabled={syncing && !syncDone} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }}>
              {syncing && !syncDone ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{syncing && !syncDone ? "Syncing…" : "Sync now"}
            </button>
          ) : (
            <Link href="/dashboard/connections" className="rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }}>
              {c?.status === "ERROR" ? `Reconnect ${platformName(platform)}` : `Connect ${platformName(platform)}`}
            </Link>
          )}
        </>} />
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          {c?.status === "CONNECTED" ? `Connected · last successful sync ${c.lastVerifiedAt ? new Date(c.lastVerifiedAt).toLocaleString() : "pending"}` : c?.status === "ERROR" ? (c.lastError ?? "Needs reconnect") : "Blinkit is not connected for this brand."}
          {meta?.from && ` · data from ${meta.from} to ${meta.to} (${meta.orderLines.toLocaleString("en-IN")} order lines)`}
        </p>
        {syncing && c && (
          <div className="mt-3 rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="mb-2 flex justify-end"><button onClick={() => setSyncing(false)} className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Hide ✕</button></div>
            <SyncProgress connectionId={c.id} since={syncSince} onFinished={onSyncFinished} />
          </div>
        )}
        {note && <p className="mt-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: note.kind === "ok" ? "var(--border)" : "var(--crit)", color: note.kind === "ok" ? "var(--ink)" : "var(--crit)" }}>{note.text}</p>}
        <div className="mt-4"><PlatformSelector value={platform} onChange={(next) => { setMeta(null); setPlatform(next); localStorage.setItem("qcp-seller-platform", next); }} /></div>
        <nav className="mt-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} aria-label="Seller data">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold"
              style={{ borderColor: path === t.href ? "var(--accent)" : "transparent", color: path === t.href ? "var(--ink)" : "var(--muted)" }}>{t.label}</Link>
          ))}
        </nav>
        <div className="mt-5">{brandId && meta ? children({ brandId, platform, meta, version }) : <p className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>Loading…</p>}</div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-card border border-dashed p-8 text-center text-[13px]" style={{ borderColor: "var(--axis)", color: "var(--muted)" }}>{text}</div>;
}
