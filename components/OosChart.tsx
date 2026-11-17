"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card } from "./Card";
import { fmtDay } from "@/lib/format";
import type { OosPoint } from "@/lib/client/analytics";

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-2.5 py-1.5 text-xs shadow-lg" style={{ background: "var(--ink)", color: "var(--plane)" }}>
      <b>{fmtDay(label)}</b> · {payload[0].value}% OOS
    </div>
  );
}

export function OosChart({ rows }: { rows: OosPoint[] }) {
  const now = rows.length ? rows[rows.length - 1].oosPct : null;
  return (
    <Card title="Stock-out rate" subtitle="Daily % of listings out of stock"
      right={now != null ? <div className="text-right"><div className="text-[19px] font-bold tracking-tight">{now}%</div></div> : undefined}>
      {rows.length === 0 ? (
        <div className="flex h-[150px] items-center justify-center text-center text-[13px]" style={{ color: "var(--muted)" }}>
          No availability data yet.
        </div>
      ) : (
        <div className="mt-1 h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 6, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="oos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--crit)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--crit)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} interval="preserveStartEnd" minTickGap={30} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={(v) => v + "%"} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <Tooltip content={<Tip />} cursor={{ stroke: "var(--axis)" }} />
              <Area type="monotone" dataKey="oosPct" stroke="var(--crit)" strokeWidth={2} fill="url(#oos)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
