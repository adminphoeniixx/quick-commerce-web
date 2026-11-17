"use client";

import type { KeywordRow } from "@/lib/client/analytics";

export function KeywordTable({ rows }: { rows: KeywordRow[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-3.5 text-[15px] font-semibold">Keyword ranking &amp; visibility</div>
      {rows.length === 0 ? (
        <div className="px-4 pb-6 text-center text-[13px]" style={{ color: "var(--muted)" }}>
          No visibility data yet — import a visibility file (data type “visibility”).
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead><tr>
              {["Keyword", "Best rank", "Avg rank", "SOV", "Sponsored", "Observations"].map((h, i) => (
                <th key={h} className={"border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider " + (i === 0 ? "text-left" : "text-right")}
                  style={{ color: "var(--muted)", borderColor: "var(--border)" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.keyword}>
                  <td className="border-b px-4 py-3 text-left font-semibold" style={{ borderColor: "var(--border)" }}>{r.keyword}</td>
                  <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>{r.bestRank ?? "—"}</td>
                  <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>{r.avgRank ?? "—"}</td>
                  <td className="tnum border-b px-4 py-3 text-right font-semibold" style={{ borderColor: "var(--border)" }}>{r.sovPct}%</td>
                  <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{r.sponsoredHits}</td>
                  <td className="tnum border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{r.observations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
