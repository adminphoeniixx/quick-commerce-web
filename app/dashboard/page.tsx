"use client";

import { useCallback, useEffect, useState } from "react";
import { ChannelTabs } from "@/components/ChannelTabs";
import { PageHeader } from "@/components/PageHeader";
import { KpiGrid } from "@/components/KpiGrid";
import { SalesTrend } from "@/components/SalesTrend";
import { PlatformBars } from "@/components/PlatformBars";
import { SovDonut } from "@/components/SovDonut";
import { CityBars } from "@/components/CityBars";
import { OosChart } from "@/components/OosChart";
import { SkuTable } from "@/components/SkuTable";
import { PricingTable } from "@/components/PricingTable";
import { KeywordTable } from "@/components/KeywordTable";
import { CategoryAnalytics } from "@/components/CategoryAnalytics";
import { AdsSummary } from "@/components/ads/AdsSummary";
import { PLATFORMS } from "@/lib/platforms";
import type { Channel } from "@/lib/types";
import {
  getBrands, getOverview, getTrend, getPlatforms, getSkus, getAvailability, getPricing, getSov, getKeywords, getCategories, getComparison,
  type Overview, type TrendPoint, type PlatformRow, type SkuRow, type BrandRow,
  type CityAvail, type OosPoint, type PriceRow, type SovData, type KeywordRow, type CategoryRow, type Comparison, type Params,
} from "@/lib/client/analytics";

const RANGES = [{ d: 7, label: "7d" }, { d: 30, label: "30d" }, { d: 90, label: "90d" }];

export default function DashboardPage() {
  const [channel, setChannel] = useState<Channel>("ALL");
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandId, setBrandId] = useState<string>("");
  const [rangeDays, setRangeDays] = useState(30);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [cityAvail, setCityAvail] = useState<CityAvail[]>([]);
  const [oosTrend, setOosTrend] = useState<OosPoint[]>([]);
  const [pricing, setPricing] = useState<PriceRow[]>([]);
  const [sov, setSov] = useState<SovData | null>(null);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [comparison, setComparison] = useState<Comparison|null>(null);
  const [activeParams, setActiveParams] = useState<Params>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => { getBrands().then(setBrands).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const to = new Date();
    const from = new Date(to.getTime() - (rangeDays - 1) * 86400000);
    const params = {
      brandId: brandId || null,
      platform: channel,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
    try {
      const [o, t, p, s, av, pr, sv, kw, cat, cmp] = await Promise.all([
        getOverview(params), getTrend(params), getPlatforms(params), getSkus(params),
        getAvailability(params), getPricing(params), getSov(params), getKeywords(params), getCategories(params), getComparison(params),
      ]);
      setOverview(o); setTrend(t); setPlatforms(p); setSkus(s);
      setCityAvail(av.byCity); setOosTrend(av.oosTrend); setPricing(pr);
      setSov(sv); setKeywords(kw);
      setCategories(cat); setComparison(cmp); setActiveParams(params);
      setUpdatedAt(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load analytics");
    } finally { setLoading(false); }
  }, [brandId, channel, rangeDays]);

  useEffect(() => { load(); }, [load]);

  const label = channel === "ALL" ? "All platforms" : PLATFORMS.find((p) => p.slug === channel)!.name;

  return (
    <div>
          <PageHeader title="Channel performance" subtitle="Sales, availability, pricing and visibility across every connected platform." />
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <ChannelTabs value={channel} onChange={setChannel} />
              <div className="flex-1" />
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)}
                className="rounded-full border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}>
                <option value="">All brands</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                {RANGES.map((r) => (
                  <button key={r.d} onClick={() => setRangeDays(r.d)}
                    className="rounded-full px-3 py-1 text-[12px] font-medium"
                    style={{ background: rangeDays === r.d ? "var(--accent)" : "transparent", color: rangeDays === r.d ? "var(--plane)" : "var(--ink-2)" }}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Key metrics — {label}{brandId ? " · " + (brands.find((b) => b.id === brandId)?.name ?? "") : ""}
            </p>
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {loading ? "Loading…" : updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ""}
            </span>
          </div>

          {error && (
            <div className="mb-4 rounded-[9px] px-3 py-2.5 text-[13px]" style={{ background: "color-mix(in srgb,var(--crit) 12%,transparent)", color: "var(--crit)" }}>{error}</div>
          )}

          {!loading && overview && overview.gmv === 0 && (
            <div className="mb-4 rounded-card border border-dashed p-5 text-center text-[13px]" style={{ borderColor: "var(--axis)", color: "var(--muted)" }}>
              No sales data for this selection yet. <a href="/dashboard/connections" className="font-semibold underline" style={{ color: "var(--accent)" }}>Connect Blinkit</a> to sync sales automatically, or import a CSV/Excel export from <b>Data import</b>.
            </div>
          )}

          <KpiGrid overview={overview} trend={trend} loading={loading} />

          {activeParams.from && activeParams.to && (channel === "ALL" || channel === "blinkit") && (
            <div className="mt-3"><AdsSummary brandId={brandId || null} from={activeParams.from} to={activeParams.to} /></div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1.55fr_1fr]">
            <SalesTrend series={trend} channel={channel} total={overview?.gmv ?? 0} />
            <PlatformBars rows={platforms} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SovDonut data={sov} />
            <CityBars rows={cityAvail} />
            <OosChart rows={oosTrend} />
          </div>

          <SkuTable rows={skus} />
          <PricingTable rows={pricing} />
          <KeywordTable rows={keywords} />
          <CategoryAnalytics rows={categories} comparison={comparison} params={activeParams} />

          <div className="mb-2 mt-5 text-xs" style={{ color: "var(--muted)" }}>
            All figures are computed from your imported data (PostgreSQL). Share-of-Voice is an observation-based visibility share; its coverage is shown on the SOV card.
          </div>
    </div>
  );
}
