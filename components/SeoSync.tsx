"use client";
// Keyword Intelligence: "Sync SEO now" (Seller Hub listing SEO + blinkit.com search for the top
// Blinkit Ads keywords) with live progress, then reloads the SEO sections below.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Card } from "@/components/Card";
import SyncProgress from "@/components/SyncProgress";
import { SearchSeo } from "@/components/SearchSeo";
import { ProductSeo } from "@/components/ProductSeo";
import { field, fieldStyle } from "@/components/seller/SellerShell";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";

interface Info { connection: { id: string; status: string; name: string; lastError: string | null } | null; keywords: string[]; runsToday: Record<string, number>; lastLocation: string | null; recent?: string[]; limitPerDay: number; totalToday?: number; limitTotalPerDay?: number; paused?: string | null; searchPaused?: string | null }
const muted = { color: "var(--muted)" };
const ALIAS: Record<string, string[]> = { gurugram: ["gurgaon"], gurgaon: ["gurugram"], bengaluru: ["bangalore"], bangalore: ["bengaluru"] };
/** Same rule as the API: runs today for the city named in the typed area. */
function runsFor(location: string, runs: Record<string, number>) {
  const t = location.toLowerCase();
  return Math.max(0, ...Object.entries(runs).filter(([c]) => [c.toLowerCase(), ...(ALIAS[c.toLowerCase()] ?? [])].some((n) => t.includes(n))).map(([, n]) => n));
}

/** Area suggestions for the dropdown: well-known Blinkit delivery areas in the main cities (area + city,
 *  the form blinkit.com's location search resolves reliably). Recently searched areas are listed first. */
const AREAS = [
  "Sector 50 Gurugram", "DLF Phase 3 Gurugram", "Sohna Road Gurugram", "Golf Course Road Gurugram",
  "Connaught Place New Delhi", "Lajpat Nagar New Delhi", "Dwarka Sector 12 New Delhi", "Rohini Sector 9 New Delhi", "Saket New Delhi",
  "Sector 18 Noida", "Sector 62 Noida", "Indirapuram Ghaziabad", "Sector 15 Faridabad",
  "Koramangala Bengaluru", "Indiranagar Bengaluru", "HSR Layout Bengaluru", "Whitefield Bengaluru", "Electronic City Bengaluru",
  "Andheri West Mumbai", "Bandra West Mumbai", "Powai Mumbai", "Lower Parel Mumbai", "Vashi Navi Mumbai", "Thane West Thane",
  "Kothrud Pune", "Baner Pune", "Viman Nagar Pune", "Hinjewadi Pune",
  "Gachibowli Hyderabad", "Banjara Hills Hyderabad", "Kondapur Hyderabad",
  "T Nagar Chennai", "Anna Nagar Chennai", "Velachery Chennai", "OMR Chennai",
  "Salt Lake Kolkata", "Park Street Kolkata", "New Town Kolkata",
  "Satellite Ahmedabad", "SG Highway Ahmedabad", "Malviya Nagar Jaipur", "Vaishali Nagar Jaipur",
  "Gomti Nagar Lucknow", "Sector 17 Chandigarh", "Vijay Nagar Indore",
];

/** "Sector 50, Gurugram, Haryana, India" → "Sector 50 Gurugram" (what blinkit.com's location search accepts). */
const shortLocation = (l: string | null) => (l ? l.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2).join(" ") : "");

export function SeoSync() {
  const [info, setInfo] = useState<Info | null>(null);
  const [location, setLocation] = useState("");
  const [search, setSearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<{ id: string; since: number } | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => apiGet<Info>("/api/seo/sync").then((i) => {
    setInfo(i);
    setLocation((cur) => cur || shortLocation(i.lastLocation));
  }).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load sync status")), []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true); setError("");
    try {
      const r = await apiPost<{ connectionId: string; since: number }>("/api/seo/sync", { search, location });
      setRunning({ id: r.connectionId, since: r.since });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not start the sync"); }
    finally { setBusy(false); }
  };

  const used = info ? runsFor(location, info.runsToday) : 0;
  const totalFull = !!info?.limitTotalPerDay && (info.totalToday ?? 0) >= info.limitTotalPerDay;
  const blocked = !!info?.paused || (search && (!!info?.searchPaused || totalFull));
  const connected = info?.connection?.status === "CONNECTED";
  return (
    <div className="space-y-6">
      <Card title="Sync SEO data" subtitle="Pulls listing SEO from your Blinkit Seller Hub and, optionally, searches blinkit.com for your top Blinkit Ads keywords at a delivery area. Runs in the connected Blinkit browser session.">
        {!info ? <p className="text-xs" style={muted}>Loading…</p> : !info.connection ? (
          <p className="text-xs">Blinkit (seller panel) is not connected. <a className="underline" href="/dashboard/connections">Connect it on the Connections page</a>.</p>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className={field} style={{ ...fieldStyle, minWidth: 280 }} placeholder="Pick or type an area + city, e.g. Sector 50 Gurugram" value={location}
                onChange={(e) => setLocation(e.target.value)} disabled={!search} aria-label="Delivery area for blinkit.com search" list="seo-area-options" autoComplete="off" />
              <datalist id="seo-area-options">
                {[...new Set([...(info.recent ?? []).map(shortLocation), ...AREAS])].map((a) => <option key={a} value={a} />)}
              </datalist>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={search} onChange={(e) => setSearch(e.target.checked)} /> Include blinkit.com keyword search</label>
              <button className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" style={{ background: "var(--accent)", color: "var(--plane)" }}
                onClick={start} disabled={busy || !!running || blocked || (!connected && !search) || (search && (location.trim().length < 3 || used >= info.limitPerDay))}>
                <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Sync SEO now
              </button>
            </div>
            <p className="text-[11px]" style={muted}>
              {info.connection.name}: <b style={{ color: connected ? undefined : "var(--crit)" }}>{info.connection.status.toLowerCase()}</b>
              {!connected && info.connection.lastError ? ` — ${info.connection.lastError}` : ""}
              {search && <> · keywords from Blinkit Ads (top {info.keywords.length} by sales): {info.keywords.join(", ") || <i>none yet: sync Blinkit Ads first</i>}
                · blinkit.com search runs today for this area: {used}/{info.limitPerDay} (all cities: {info.totalToday ?? 0}/{info.limitTotalPerDay ?? "–"})</>}
            </p>
            {!connected && <p className="text-xs" style={{ color: "var(--warn)" }}>
              {search ? "No login needed for the blinkit.com keyword search: it will run now. " : "Listing SEO needs the Blinkit seller login. "}
              Product listing SEO (content, stores, availability) is skipped until you <a className="font-semibold underline" href="/dashboard/connections">reconnect Blinkit</a>.
            </p>}
            {search && location.trim().length < 3 && <p className="text-xs" style={{ color: "var(--warn)" }}>Enter a delivery area + city (e.g. Sector 50 Gurugram) to enable the sync{connected ? ", or untick the blinkit.com search to sync listing SEO only" : ""}.</p>}
            {search && location.trim().length >= 3 && used >= info.limitPerDay && <p className="text-xs" style={{ color: "var(--warn)" }}>blinkit.com search already ran {info.limitPerDay}x today for this city. Try tomorrow, another city, or untick the search.</p>}
            {(info.paused || (search && info.searchPaused)) && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--crit)", color: "var(--crit)" }}>{info.paused ?? info.searchPaused}</p>}
            {search && totalFull && !info.searchPaused && <p className="text-xs" style={{ color: "var(--warn)" }}>blinkit.com search already ran {info.totalToday}x today across all cities (limit {info.limitTotalPerDay} a day to keep your IP safe). Try tomorrow.</p>}
            {error && <p className="text-xs" style={{ color: "var(--crit)" }}>{error}</p>}
          </div>
        )}
      </Card>
      {running && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} role="dialog" aria-modal="true">
        <div className="w-full max-w-[1000px] rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="mb-3 flex items-center"><h2 className="mr-auto font-semibold">Syncing SEO data</h2><button onClick={() => { setRunning(null); load(); setVersion((v) => v + 1); }} aria-label="Close"><X size={18} /></button></div>
          <SyncProgress connectionId={running.id} since={running.since} onFinished={() => { load(); setVersion((v) => v + 1); }} />
          <p className="mt-3 text-[11px]" style={muted}>You can close this window; the sync keeps running in the background.</p>
        </div>
      </div>}
      <SearchSeo key={`s${version}`} />
      <ProductSeo key={`p${version}`} />
    </div>
  );
}
