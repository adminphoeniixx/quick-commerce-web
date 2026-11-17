"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card } from "./Card";
import { PLATFORMS } from "@/lib/platforms";
import { fmtINR, fmtDay } from "@/lib/format";
import type { TrendPoint } from "@/lib/client/analytics";
import type { Channel } from "@/lib/types";

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + p.value, 0);
  return (
    <div className="rounded-lg px-2.5 py-2 text-xs shadow-lg" style={{ background: "var(--ink)", color: "var(--plane)" }}>
      <b>{fmtDay(label)}</b>
      {payload.length > 1 && (
        <div className="mt-1 flex items-center gap-1.5"><span style={{ opacity: 0.6 }}>Total</span><span className="tnum font-semibold">{fmtINR(total)}</span></div>
      )}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="mt-1 flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
          <span className="capitalize" style={{ opacity: 0.6 }}>{p.dataKey}</span>
          <span className="tnum ml-auto font-semibold">{fmtINR(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function SalesTrend({ series, channel, total }: { series: TrendPoint[]; channel: Channel; total: number }) {
  const shown = channel === "ALL" ? PLATFORMS : PLATFORMS.filter((p) => p.slug === channel);
  const hasData = series.length > 0;

  return (
    <Card
      title="Sales trend"
      subtitle="Daily GMV from imported data"
      right={<div className="text-right"><div className="text-[19px] font-bold tracking-tight">{fmtINR(total)}</div></div>}
    >
      <div className="mb-1 mt-2.5 flex flex-wrap gap-3.5 text-xs" style={{ color: "var(--ink-2)" }}>
        {shown.map((p) => (
          <span key={p.slug} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />{p.name}</span>
        ))}
      </div>
      <div className="h-[240px] w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
              <defs>
                {shown.map((p) => (
                  <linearGradient key={p.slug} id={`a-${p.slug}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => fmtINR(v).replace("₹", "")} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} />
              <Tooltip content={<TooltipBox />} cursor={{ stroke: "var(--axis)" }} />
              {shown.map((p) => (
                <Area key={p.slug} type="monotone" dataKey={p.slug} stackId="1" stroke={p.color} strokeWidth={2} fill={`url(#a-${p.slug})`} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : <EmptyPlot />}
      </div>
    </Card>
  );
}

function EmptyPlot() {
  return (
    <div className="flex h-full items-center justify-center text-center text-[13px]" style={{ color: "var(--muted)" }}>
      No sales data yet — import a CSV/Excel file to see this chart.
    </div>
  );
}
