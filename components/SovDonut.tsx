"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card } from "./Card";
import type { SovData } from "@/lib/client/analytics";

const RIVAL_COLORS = ["var(--blinkit)", "var(--zepto)", "var(--instamart)", "var(--bigbasket)", "var(--muted)"];

export function SovDonut({ data }: { data: SovData | null }) {
  const hasData = !!data && data.donut.length > 0;
  // top 5 + merge the rest into "Others"
  const slices = hasData
    ? (() => {
        const sorted = [...data!.donut];
        const top = sorted.slice(0, 5);
        const rest = sorted.slice(5);
        if (rest.length) top.push({ brand: "Others", isOwn: false, count: rest.reduce((s, r) => s + r.count, 0), share: Math.round(rest.reduce((s, r) => s + r.share, 0) * 10) / 10 });
        return top;
      })()
    : [];
  const colorOf = (s: { isOwn: boolean }, i: number) => (s.isOwn ? "var(--accent)" : RIVAL_COLORS[i % RIVAL_COLORS.length]);

  return (
    <Card title="Share of Voice" subtitle="Observation-based visibility share">
      {!hasData ? (
        <div className="flex h-[150px] items-center justify-center text-center text-[13px]" style={{ color: "var(--muted)" }}>
          Needs keyword / ranking data.<br />Import a visibility file.
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-4">
            <div className="relative h-[120px] w-[120px] flex-none">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="share" nameKey="brand" innerRadius={30} outerRadius={50} paddingAngle={1} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
                    {slices.map((s, i) => <Cell key={s.brand} fill={colorOf(s, i)} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-[18px] font-bold leading-none">{data!.sovPct ?? 0}%</div>
                <div className="text-[10px]" style={{ color: "var(--muted)" }}>our SOV</div>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {slices.map((s, i) => (
                <div key={s.brand} className="flex items-center gap-2 text-[12px]">
                  <i className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: colorOf(s, i) }} />
                  <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink-2)", fontWeight: s.isOwn ? 700 : 400 }}>{s.brand}</span>
                  <b className="tnum">{s.share}%</b>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 border-t pt-2 text-[10px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            Coverage: {data!.coverage.keywords} keywords · {data!.coverage.cities} cities · {data!.coverage.observations} observations
            {" · "}organic {data!.organicVsSponsored.organic} / sponsored {data!.organicVsSponsored.sponsored}
          </div>
        </>
      )}
    </Card>
  );
}
