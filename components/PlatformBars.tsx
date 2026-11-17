"use client";

import { Card } from "./Card";
import { platformColor, platformName } from "@/lib/platforms";
import { fmtINR } from "@/lib/format";
import type { PlatformRow } from "@/lib/client/analytics";

export function PlatformBars({ rows }: { rows: PlatformRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.gmv));
  return (
    <Card title="Sales by platform" subtitle="GMV contribution this period">
      {rows.length === 0 ? (
        <p className="mt-6 text-center text-[13px]" style={{ color: "var(--muted)" }}>No data for this period.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3.5">
          {rows.map((r) => (
            <div key={r.platform}>
              <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                <b className="inline-flex items-center gap-2 font-semibold">
                  <span className="h-2 w-2 rounded-full" style={{ background: platformColor(r.platform) }} />{platformName(r.platform)}
                </b>
                <span className="tnum font-semibold">{fmtINR(r.gmv)}<small className="ml-1.5 font-medium" style={{ color: "var(--muted)" }}>{r.share}%</small></span>
              </div>
              <div className="h-[9px] overflow-hidden rounded-[5px]" style={{ background: "var(--surface-2)" }}>
                <i className="block h-full rounded-[5px]" style={{ width: `${(r.gmv / max) * 100}%`, background: platformColor(r.platform) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
