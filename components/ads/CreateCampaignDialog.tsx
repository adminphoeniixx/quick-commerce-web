"use client";

import { useMemo, useState } from "react";
import { Copy, X } from "lucide-react";
import { ApiError, apiPost } from "@/lib/client/api";
import { inr, TYPE_LABEL } from "./AdsShell";
import type { CampaignTemplate } from "@/lib/ads/campaigns/types";
import { validateCampaignForm } from "@/lib/ads/campaigns/validation";

const inputClass = "h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2";
const today = () => new Date().toISOString().slice(0, 10);

export function CreateCampaignDialog({ campaigns, query }: { campaigns: CampaignTemplate[]; query: string }) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(campaigns[0]?.campaignId ?? "");
  const template = campaigns.find((row) => row.campaignId === templateId) ?? campaigns[0];
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [noEnd, setNoEnd] = useState(true);
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resetFrom = (row: CampaignTemplate) => {
    setTemplateId(row.campaignId);
    setName(`${row.name} copy`);
    setBudget(String(row.budget ?? ""));
    setNoEnd(row.endAt == null);
    setEnd(row.endAt?.slice(0, 10) ?? "");
    setError("");
  };
  const show = () => { if (template) { resetFrom(template); setOpen(true); } };
  const validation = useMemo(() => validateCampaignForm({ name, budget, noEnd, end, today: today() }), [name, budget, noEnd, end]);

  const submit = async () => {
    if (!template || validation) return;
    setBusy(true); setError("");
    try {
      const result = await apiPost<{ campaignId: string }>(`/api/ads/campaigns/${template.campaignId}/action?${query}`, {
        action: "duplicate", expectedStatus: template.status, expectedBudget: template.budget,
        name: name.trim(), budget: Number(budget), start: today(), noEnd,
        ...(noEnd ? {} : { end }),
      });
      window.location.assign(`/dashboard/ads/campaigns/${result.campaignId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Blinkit could not create this campaign.");
    } finally { setBusy(false); }
  };

  if (!template) return null;
  return <>
    <button onClick={show} className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>+ Create campaign</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,12,14,.62)", backdropFilter: "blur(3px)" }} role="dialog" aria-modal="true" aria-labelledby="create-campaign-title">
      <div className="w-full max-w-[600px] overflow-hidden rounded-2xl border shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-start gap-4 border-b px-6 py-5" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0 flex-1"><h2 id="create-campaign-title" className="text-lg font-semibold">Create Blinkit campaign</h2><p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Choose a proven campaign as template. Products, targeting, keywords and ad format will be copied.</p></div>
          <button onClick={() => !busy && setOpen(false)} aria-label="Close" className="rounded-lg p-1.5"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <label className="grid gap-1.5"><span className="text-xs font-medium">Template campaign</span><select aria-label="Template campaign" className={inputClass} style={{ borderColor: "var(--border)" }} value={template.campaignId} onChange={(e) => { const row = campaigns.find((item) => item.campaignId === e.target.value); if (row) resetFrom(row); }}>{campaigns.map((row) => <option key={row.campaignId} value={row.campaignId}>{row.name} · {TYPE_LABEL[row.type] ?? row.type}</option>)}</select></label>
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg)" }}><div className="flex items-center gap-2 font-semibold"><Copy size={14} /> Copying #{template.campaignId}</div><div className="mt-1 flex gap-4" style={{ color: "var(--muted)" }}><span>{template.productIds.length} products</span><span>{inr(template.budget)} current budget</span></div></div>
          <label className="grid gap-1.5"><span className="text-xs font-medium">New campaign name</span><input aria-label="New campaign name" className={inputClass} style={{ borderColor: "var(--border)" }} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">Budget (₹)</span><input aria-label="Budget (₹)" className={inputClass} style={{ borderColor: "var(--border)" }} type="number" min="1" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="grid gap-1.5"><span className="text-xs font-medium">End date</span><input aria-label="End date" className={inputClass} style={{ borderColor: "var(--border)" }} type="date" min={today()} value={end} disabled={noEnd} onChange={(e) => setEnd(e.target.value)} /></label><label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border)" }}><input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} /> No end date</label></div>
          {(validation || error) && <div role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "color-mix(in srgb, var(--crit) 45%, var(--border))", color: "var(--crit)" }}>{error || validation}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "var(--border)", background: "var(--bg)" }}><button disabled={busy} onClick={() => setOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button><button disabled={busy || !!validation} onClick={submit} className="h-10 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>{busy ? "Creating…" : "Create campaign"}</button></div>
      </div>
    </div>}
  </>;
}
