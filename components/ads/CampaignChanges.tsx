"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/client/api";
import { Card } from "@/components/Card";
import { inr } from "./AdsShell";

interface Change { id: string; campaignId: string; campaignName: string; kind: "update" | "restart" | "stop"; expectedStatus: string; expectedBudget: number | null; toBudget: number | null; status: string; reason: string; growthPlanId: string | null; decidedBy: string | null; error: string | null; createdAt: string }
const label = { update: "Raise budget", restart: "Restart", stop: "Stop" } as const;
const tone = (s: string) => s === "APPLIED" ? "var(--ok, var(--accent))" : s === "FAILED" ? "var(--crit)" : s === "PENDING" || s === "APPLYING" ? "var(--warn)" : "var(--muted)";

/** Pending campaign changes from the Keyword Growth Agent: nothing reaches Blinkit until approved here. */
export function CampaignChanges({ query, version }: { query: string; version?: number }) {
  const [rows, setRows] = useState<Change[]>([]), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const load = useCallback((fresh = false) => apiGet<{ changes: Change[] }>(`/api/ads/campaigns/changes?${query}${fresh ? `&_t=${Date.now()}` : ""}`).then((r) => setRows(r.changes)).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load campaign changes")), [query]);
  useEffect(() => { load(); }, [load, version]);
  const decide = async (c: Change, action: "approve" | "reject") => {
    if (action === "approve" && c.kind === "stop" && !window.confirm(`Stop "${c.campaignName}" on Blinkit? Its ads stop serving immediately.`)) return;
    setBusy(c.id); setError("");
    try { await apiPost(`/api/ads/campaigns/changes/${c.id}/decide?${query}`, { action }); } catch (e) { setError(e instanceof ApiError ? e.message : "Could not update the change"); } finally { setBusy(null); await load(true); }
  };
  const open = rows.filter((r) => ["PENDING", "APPLYING", "FAILED"].includes(r.status)), recent = rows.filter((r) => !open.includes(r)).slice(0, 5);
  if (!rows.length) return null;
  return <Card title={`Pending campaign changes (${open.length})`} subtitle="Budget, restart and stop proposals from the Keyword Growth Agent. Blinkit refuses a change if the campaign was edited meanwhile.">
    {error && <p role="alert" className="mb-2 text-sm" style={{ color: "var(--crit)" }}>{error}</p>}
    <div className="space-y-2">{[...open, ...recent].map((c) => <div key={c.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>{label[c.kind]} · {c.campaignName}</b>
        <span className="text-xs font-semibold" style={{ color: tone(c.status) }}>{c.status.toLowerCase()}</span>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>#{c.campaignId} · {c.expectedStatus} · budget {inr(c.expectedBudget ?? 0)}{c.kind !== "stop" && c.toBudget != null ? ` → ${inr(c.toBudget)}/day` : ""}{c.growthPlanId ? ` · growth plan #${c.growthPlanId}` : ""}</p>
      <p className="mt-1">{c.reason}</p>
      {c.error && <p className="mt-1 text-xs" style={{ color: "var(--crit)" }}>{c.error}</p>}
      {["PENDING", "FAILED"].includes(c.status) && <div className="mt-2 flex gap-2">
        <button disabled={busy === c.id} onClick={() => decide(c, "approve")} className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--plane)" }}>{c.status === "FAILED" ? "Retry" : "Approve & apply"}</button>
        {c.status === "PENDING" && <button disabled={busy === c.id} onClick={() => decide(c, "reject")} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border)" }}>Reject</button>}
      </div>}
    </div>)}</div>
  </Card>;
}
