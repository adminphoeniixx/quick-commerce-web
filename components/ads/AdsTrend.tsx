"use client";
// Daily ad spend vs. ad-attributed sales (both ₹, one axis), with optional total Blinkit
// seller sales for context. Hover shows every value plus ROAS for the day.
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card } from "@/components/Card";
import { fmtINR, fmtDay } from "@/lib/format";

export interface AdsTrendPoint { date: string; spend: number; sales: number; impressions?: number; sellerGmv?: number }

const SERIES = [
  { key: "spend", label: "Ad spend", color: "var(--blinkit)" },
  { key: "sales", label: "Ad-attributed sales", color: "var(--ink-2)" },
  { key: "sellerGmv", label: "All Blinkit sales", color: "var(--axis)" },
] as const;

function Tip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string; payload: AdsTrendPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg px-2.5 py-2 text-xs shadow-lg" style={{ background: "var(--ink)", color: "var(--plane)" }}>
      <b>{label ? fmtDay(label) : ""}</b>
      {payload.map((x) => (
        <div key={x.dataKey} className="mt-1 flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-[2px]" style={{ background: x.color }} />
          <span style={{ opacity: 0.7 }}>{SERIES.find((s) => s.key === x.dataKey)?.label}</span>
          <span className="tnum ml-auto pl-3 font-semibold">₹{Math.round(x.value).toLocaleString("en-IN")}</span>
        </div>
      ))}
      <div className="mt-1 flex gap-1.5"><span style={{ opacity: 0.7 }}>ROAS</span><span className="tnum ml-auto font-semibold">{p.spend ? (p.sales / p.spend).toFixed(2) + "x" : "—"}</span></div>
      {p.impressions != null && <div className="mt-1 flex gap-1.5"><span style={{ opacity: 0.7 }}>Impressions</span><span className="tnum ml-auto font-semibold">{p.impressions.toLocaleString("en-IN")}</span></div>}
    </div>
  );
}

export function AdsTrend({ data, title = "Ad spend vs. sales", subtitle = "Daily, IST", withSeller = false }: { data: AdsTrendPoint[]; title?: string; subtitle?: string; withSeller?: boolean }) {
  const shown = SERIES.filter((s) => s.key !== "sellerGmv" || withSeller);
  return (
    <Card title={title} subtitle={subtitle}>
      <div className="mb-1 mt-2 flex flex-wrap gap-3.5 text-xs" style={{ color: "var(--ink-2)" }}>
        {shown.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="h-[260px] w-full">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -8 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => fmtINR(v).replace("₹", "")} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} />
              <Tooltip content={<Tip />} cursor={{ fill: "var(--surface-2)" }} />
              {withSeller && <Line dataKey="sellerGmv" stroke="var(--axis)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
              <Bar dataKey="spend" fill="var(--blinkit)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Line dataKey="sales" stroke="var(--ink-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "var(--muted)" }}>No ad activity in this period.</div>}
      </div>
    </Card>
  );
}
