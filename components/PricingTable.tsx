"use client";

import { platformColor, platformName } from "@/lib/platforms";
import type { PriceRow } from "@/lib/client/analytics";

export function PricingTable({ rows }: { rows: PriceRow[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-3.5 text-[15px] font-semibold">Pricing &amp; discounts</div>
      {rows.length === 0 ? (
        <div className="px-4 pb-6 text-center text-[13px]" style={{ color: "var(--muted)" }}>
          No pricing data yet — import a pricing file (data type “pricing”).
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead><tr>
              {["Product", "Platform", "MRP", "Selling price", "Discount"].map((h, i) => (
                <th key={h} className={"border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider " + (i === 0 ? "text-left" : "text-right")}
                  style={{ color: "var(--muted)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.skuCode + r.platform + i}>
                  <td className="border-b px-4 py-3 text-left" style={{ borderColor: "var(--border)" }}>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-[11px]" style={{ color: "var(--muted)" }}>{r.skuCode}</div>
                  </td>
                  <td className="border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium"><i className="h-2 w-2 rounded-full" style={{ background: platformColor(r.platform) }} />{platformName(r.platform)}</span>
                  </td>
                  <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{r.mrp != null ? "₹" + r.mrp : "—"}</td>
                  <td className="tnum border-b px-4 py-3 text-right font-semibold" style={{ borderColor: "var(--border)" }}>₹{r.sellingPrice}</td>
                  <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>
                    {r.discountPct != null ? <span style={{ color: "var(--good-ink)" }}>{r.discountPct}%</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
