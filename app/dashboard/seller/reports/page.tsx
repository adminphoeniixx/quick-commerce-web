"use client";
import { useEffect, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { SellerShell, Empty, type SellerMeta } from "@/components/seller/SellerShell";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";

interface Report {
  id: string; reportType: string; rangeLabel: string | null; periodFrom: string | null; periodTo: string | null; status: string;
  rowsTotal: number; rowsImported: number; fileName: string | null; error: string | null; trigger: string; createdAt: string;
}

const TYPE: Record<string, string> = { sales_summary: "Sales summary (orders)", product_listing: "Product list", stock_on_hand: "Stock on hand (inventory)" };

function ReportsView({ brandId, platform, meta, version }: { brandId: string; platform: string; meta: SellerMeta; version: number }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ reports: Report[] }>(`/api/seller/reports?brandId=${brandId}&platform=${platform}`).then((r) => setReports(r.reports)).catch(() => setReports([]));
  }, [brandId, platform, version]);

  async function retry(range: string) {
    if (!meta.connection) return;
    setMsg(null);
    try { await apiPost(`/api/connections/${meta.connection.id}/sync`, { ranges: [range] }); setMsg(`Retrying "${range}". Refresh this page in a minute.`); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : "Retry failed"); }
  }

  if (reports && !reports.length) return <Empty text="No reports for the selected platform yet. Connect or import data first." />;
  return (
    <div className="space-y-3">
      {msg && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>{msg}</p>}
      <div className="overflow-x-auto rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full min-w-[900px] text-[12px]">
          <thead><tr style={{ color: "var(--muted)" }}>{["Synced at", "Report", "Blinkit range", "Data period", "Rows imported", "Status", "Trigger", ""].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{reports?.map((r) => (
            <tr key={r.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
              <td className="whitespace-nowrap px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
              <td className="px-3">{TYPE[r.reportType] ?? r.reportType}</td>
              <td className="px-3">{r.rangeLabel ?? "—"}</td>
              <td className="tnum whitespace-nowrap px-3">{r.periodFrom ? `${r.periodFrom.slice(0, 10)} → ${r.periodTo?.slice(0, 10)}` : "—"}</td>
              <td className="tnum px-3">{r.status === "SUCCESS" ? `${r.rowsImported.toLocaleString("en-IN")} / ${r.rowsTotal.toLocaleString("en-IN")}` : "—"}</td>
              <td className="px-3"><span className="font-semibold" style={{ color: r.status === "SUCCESS" ? "var(--ink)" : "var(--crit)" }}>{r.status === "SUCCESS" ? "✓ Success" : "✕ Failed"}</span>{r.error && <div className="mt-0.5 max-w-[260px] text-[11px]" style={{ color: "var(--muted)" }}>{r.error}</div>}</td>
              <td className="px-3 capitalize">{r.trigger}</td>
              <td className="whitespace-nowrap px-3">
                {r.fileName && <a href={`/api/seller/reports/${r.id}/file`} className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--accent)" }}><Download size={13} />File</a>}
                {r.status !== "SUCCESS" && r.reportType === "sales_summary" && r.rangeLabel && meta.connection?.status === "CONNECTED" && (
                  <button onClick={() => retry(r.rangeLabel!)} className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--accent)" }}><RotateCcw size={13} />Retry</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function SellerReportsPage() {
  return (
    <SellerShell title="Synced reports" subtitle="Every report for the selected platform: when, which range, how many rows reached QCP, and the original file.">
      {(ctx) => <ReportsView {...ctx} />}
    </SellerShell>
  );
}
