"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList, ResponsiveContainer } from "recharts";
import { Card } from "./Card";
import type { CityAvail } from "@/lib/client/analytics";

function color(v: number) {
  return v >= 90 ? "var(--bigbasket)" : v >= 85 ? "var(--blinkit)" : "var(--instamart)";
}

export function CityBars({ rows }: { rows: CityAvail[] }) {
  return (
    <Card title="Availability by city" subtitle="% of fulfilment locations with sellable stock">
      {rows.length === 0 ? (
        <div className="flex h-[150px] items-center justify-center text-center text-[13px]" style={{ color: "var(--muted)" }}>
          No availability data yet — import an availability file.
        </div>
      ) : (
        <div className="mt-2 h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="city" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(c) => String(c).split(" ")[0]} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <Bar dataKey="availability" radius={[4, 4, 0, 0]} isAnimationActive={false} minPointSize={2}>
                {rows.map((c) => <Cell key={c.city} fill={color(c.availability)} />)}
                <LabelList dataKey="availability" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
