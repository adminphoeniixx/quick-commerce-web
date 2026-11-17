"use client";

import {
  IndianRupee, Boxes, CheckCheck, Radio, CircleOff, Coins, ArrowUp, ArrowDown,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { fmtINR, fmtN } from "@/lib/format";
import type { Overview, TrendPoint } from "@/lib/client/analytics";

const ICONS = { gmv: IndianRupee, units: Boxes, avail: CheckCheck, sov: Radio, oos: CircleOff, price: Coins };

function Delta({ pct, lowerBetter }: { pct: number | null; lowerBetter?: boolean }) {
  if (pct == null) return <span className="text-[11px]" style={{ color: "var(--muted)" }}>no prior period</span>;
  const up = pct >= 0;
  const positive = lowerBetter ? !up : up;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: positive ? "var(--good-ink)" : "var(--crit)" }}>
      {up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{up ? "+" : ""}{pct}%
    </span>
  );
}

export function KpiGrid({ overview, trend, loading }: { overview: Overview | null; trend: TrendPoint[]; loading: boolean }) {
  const spark = trend.map((d) => ({
    v: Object.entries(d).filter(([k]) => k !== "date").reduce((s, [, v]) => s + Number(v || 0), 0),
  }));

  const tiles = [
    { key: "gmv", label: "Total GMV", icon: ICONS.gmv, value: overview ? fmtINR(overview.gmv) : "—", delta: overview?.deltaGmvPct ?? null, spark: true },
    { key: "units", label: "Units sold", icon: ICONS.units, value: overview ? fmtN(overview.units) : "—", delta: overview?.deltaUnitsPct ?? null, spark: true },
    { key: "price", label: "Avg selling price", icon: ICONS.price, value: overview?.avgSellPrice != null ? "₹" + overview.avgSellPrice : "—", delta: null },
    { key: "avail", label: "Availability", icon: ICONS.avail, value: overview?.availabilityPct != null ? overview.availabilityPct + "%" : "—", delta: null, noData: overview?.availabilityPct == null },
    { key: "sov", label: "Share of Voice", icon: ICONS.sov, value: overview?.sovPct != null ? overview.sovPct + "%" : "—", delta: null, noData: overview?.sovPct == null },
    { key: "oos", label: "Stock-out rate", icon: ICONS.oos, value: overview?.oosPct != null ? overview.oosPct + "%" : "—", delta: null, noData: overview?.oosPct == null, lowerBetter: true },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.key} className="min-w-0 rounded-card border p-[14px_15px]" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--ink-2)" }}>
              <Icon size={14} style={{ color: "var(--muted)" }} />{t.label}
            </div>
            <div className="tnum my-1.5 text-[23px] font-bold tracking-tight" style={{ opacity: loading ? 0.4 : 1 }}>{t.value}</div>
            {t.noData
              ? <span className="text-[11px]" style={{ color: "var(--muted)" }}>needs availability/SOV data</span>
              : <Delta pct={t.delta} lowerBetter={t.lowerBetter} />}
            {t.spark && spark.length > 1 && (
              <div className="mt-2.5 h-[30px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`sp-${t.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} fill={`url(#sp-${t.key})`} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
