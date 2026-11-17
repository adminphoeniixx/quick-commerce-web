"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { platformColor, platformName } from "@/lib/platforms";
import { fmtINR, fmtN } from "@/lib/format";
import type { SkuRow } from "@/lib/client/analytics";

type SortKey = "name" | "platform" | "gmv" | "units" | "avgPrice";
const COLS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Product" },
  { key: "platform", label: "Platform" },
  { key: "gmv", label: "GMV" },
  { key: "units", label: "Units" },
  { key: "avgPrice", label: "Avg price" },
];

export function SkuTable({ rows }: { rows: SkuRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("gmv");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    let r = rows;
    if (q) r = r.filter((s) => (s.name + s.skuCode).toLowerCase().includes(q.toLowerCase()));
    return [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return (Number(av ?? 0) - Number(bv ?? 0)) * dir;
    });
  }, [rows, q, sortKey, dir]);

  function toggle(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setDir(k === "name" || k === "platform" ? 1 : -1); }
  }

  return (
    <div className="mt-5 overflow-hidden rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <h3 className="text-[15px] font-semibold">SKU performance</h3>
        <div className="flex items-center gap-2 rounded-[9px] border px-2.5 py-1.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <Search size={15} style={{ color: "var(--muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU…" aria-label="Search SKU"
            className="w-[150px] bg-transparent text-[13px] outline-none" style={{ color: "var(--ink)" }} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead><tr>
            {COLS.map((c, i) => (
              <th key={c.key} onClick={() => toggle(c.key)}
                className={"cursor-pointer select-none whitespace-nowrap border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider " + (i === 0 ? "text-left" : "text-right")}
                style={{ color: "var(--muted)", borderColor: "var(--border)" }}>
                {c.label}<span style={{ opacity: sortKey === c.key ? 1 : 0 }}>{dir < 0 ? " ▾" : " ▴"}</span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {view.map((s, idx) => (
              <tr key={s.skuCode + s.platform + idx}>
                <td className="border-b px-4 py-3 text-left" style={{ borderColor: "var(--border)" }}>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>{s.skuCode}</div>
                </td>
                <td className="border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium"><i className="h-2 w-2 rounded-full" style={{ background: platformColor(s.platform) }} />{platformName(s.platform)}</span>
                </td>
                <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>{fmtINR(s.gmv)}</td>
                <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>{fmtN(s.units)}</td>
                <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>{s.avgPrice != null ? "₹" + s.avgPrice : "—"}</td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={COLS.length} className="px-4 py-7 text-center" style={{ color: "var(--muted)" }}>
                No SKU sales yet — import data to populate this table.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
