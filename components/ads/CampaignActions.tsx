"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Play, Square, X } from "lucide-react";
import { apiPost, ApiError } from "@/lib/client/api";
import { inr } from "./AdsShell";

export interface ManagedCampaign {
  campaignId: string;
  name: string;
  status: string;
  budget: number | null;
  startAt: string | null;
  endAt: string | null;
}

type Mode = "update" | "restart" | "stop";

const inputClass = "h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2";

export function CampaignActions({ campaign, query }: { campaign: ManagedCampaign; query: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState(campaign.name);
  const [budget, setBudget] = useState(String(campaign.budget ?? ""));
  const [noEnd, setNoEnd] = useState(campaign.endAt == null);
  const [end, setEnd] = useState(campaign.endAt?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mode) return;
    setName(campaign.name);
    setBudget(String(campaign.budget ?? ""));
    setNoEnd(campaign.endAt == null);
    setEnd(campaign.endAt?.slice(0, 10) ?? "");
    setError("");
  }, [mode, campaign]);

  const stopped = campaign.status === "STOPPED" || campaign.status === "COMPLETED";
  const title = mode === "update" ? "Edit campaign" : mode === "restart" ? "Restart campaign" : "Stop campaign";
  const description = mode === "update" ? "Update the campaign name, budget, or end date on Blinkit Ads."
    : mode === "restart" ? "Restart serving with a fresh start date and confirmed budget."
    : "The campaign will stop serving immediately. Reporting history remains available.";

  const validation = useMemo(() => {
    if (!mode || mode === "stop") return "";
    const amount = Number(budget);
    if (!name.trim()) return "Campaign name is required.";
    if (!Number.isFinite(amount) || amount <= 0) return "Enter a valid positive budget.";
    if (!noEnd && !end) return "Choose an end date or select no end date.";
    if (end && end < new Date().toISOString().slice(0, 10)) return "End date cannot be in the past.";
    return "";
  }, [mode, name, budget, noEnd, end]);

  const submit = async () => {
    if (!mode || validation) return;
    setBusy(true); setError("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      const result = await apiPost<{ campaignId: string }>(`/api/ads/campaigns/${campaign.campaignId}/action?${query}`, {
        action: mode,
        expectedStatus: campaign.status,
        expectedBudget: campaign.budget,
        ...(mode === "stop" ? {} : {
          name: name.trim(), budget: Number(budget), noEnd,
          ...(noEnd ? {} : { end }),
          ...(mode === "restart" ? { start: today } : {}),
        }),
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Blinkit could not apply this campaign change.");
    } finally { setBusy(false); }
  };

  return <>
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => setMode("update")} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: "var(--border)", background: "var(--surface)" }}><Pencil size={14} /> Edit</button>
      {stopped
        ? <button onClick={() => setMode("restart")} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}><Play size={14} /> Restart</button>
        : <button onClick={() => setMode("stop")} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: "color-mix(in srgb, var(--crit) 45%, var(--border))", color: "var(--crit)" }}><Square size={13} /> Stop</button>}
    </div>

    {mode && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,12,14,.62)", backdropFilter: "blur(3px)" }} role="dialog" aria-modal="true" aria-labelledby="campaign-dialog-title">
      <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-start gap-4 border-b px-6 py-5" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0 flex-1"><h2 id="campaign-dialog-title" className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm leading-5" style={{ color: "var(--muted)" }}>{description}</p></div>
          <button onClick={() => !busy && setMode(null)} aria-label="Close" className="rounded-lg p-1.5 hover:bg-black/5"><X size={18} /></button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            <div className="font-semibold">{campaign.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1" style={{ color: "var(--muted)" }}><span>#{campaign.campaignId}</span><span>{campaign.status}</span><span>Current budget {inr(campaign.budget)}</span></div>
          </div>

          {mode !== "stop" ? <div className="space-y-4">
            <label className="grid gap-1.5"><span className="text-xs font-medium">Campaign name</span><input className={inputClass} style={{ borderColor: "var(--border)" }} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></label>
            <label className="grid gap-1.5"><span className="text-xs font-medium">Budget (₹)</span><input className={inputClass} style={{ borderColor: "var(--border)" }} type="number" min="1" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /><span className="text-[11px]" style={{ color: "var(--muted)" }}>Blinkit validates minimums and format-specific limits before accepting the change.</span></label>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="grid gap-1.5"><span className="text-xs font-medium">End date</span><input className={inputClass} style={{ borderColor: "var(--border)" }} type="date" min={new Date().toISOString().slice(0, 10)} value={end} disabled={noEnd} onChange={(e) => setEnd(e.target.value)} /></label>
              <label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border)" }}><input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} /> No end date</label>
            </div>
          </div> : <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "color-mix(in srgb, var(--crit) 35%, var(--border))", background: "color-mix(in srgb, var(--crit) 6%, var(--surface))" }}><strong>This does not delete campaign history.</strong><p className="mt-1" style={{ color: "var(--muted)" }}>Blinkit treats its campaign DELETE operation as Stop. You can restart later if Blinkit allows that transition.</p></div>}

          {(validation || error) && <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "color-mix(in srgb, var(--crit) 45%, var(--border))", color: "var(--crit)" }}>{error || validation}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <button disabled={busy} onClick={() => setMode(null)} className="h-10 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Cancel</button>
          <button disabled={busy || !!validation} onClick={submit} className="h-10 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ background: mode === "stop" ? "var(--crit)" : "var(--accent)" }}>{busy ? "Applying…" : mode === "stop" ? "Stop campaign" : mode === "restart" ? "Restart campaign" : "Save changes"}</button>
        </div>
      </div>
    </div>}
  </>;
}
