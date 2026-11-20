"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, X } from "lucide-react";
import { ApiError, apiPost } from "@/lib/client/api";
import { inr, TYPE_LABEL } from "./AdsShell";

export interface CampaignTemplate {
  campaignId: string;
  name: string;
  type: string;
  status: string;
  budget: number | null;
  endAt: string | null;
  productIds: string[];
}

const inputClass = "h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2";
const today = () => new Date().toISOString().slice(0, 10);

export function CreateCampaignDialog({ campaigns, query }: { campaigns: CampaignTemplate[]; query: string }) {
  const templates = campaigns.filter((row) => ["STOPPED", "COMPLETED"].includes(row.status));
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.campaignId ?? "");
  const template = templates.find((row) => row.campaignId === templateId) ?? templates[0];
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposalId, setProposalId] = useState("");

  const resetFrom = (row: CampaignTemplate) => {
    setTemplateId(row.campaignId);
    setName(`${row.name} copy`);
    setBudget(String(row.budget ?? ""));
    const finish = new Date(); finish.setUTCDate(finish.getUTCDate() + 13);
    setEnd(finish.toISOString().slice(0, 10));
    setProposalId("");
    setError("");
  };
  const show = () => { if (template) { resetFrom(template); setOpen(true); } };
  const validation = useMemo(() => {
    if (!name.trim()) return "Campaign name is required.";
    if (!Number.isFinite(Number(budget)) || Number(budget) <= 0) return "Enter a valid positive budget.";
    if (!end) return "Choose an end date.";
    if (end && end < today()) return "End date cannot be in the past.";
    const days = Math.floor((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${today()}T00:00:00Z`).getTime()) / 86400_000) + 1;
    if (days > 30) return "Campaign duration cannot exceed 30 days.";
    return "";
  }, [name, budget, end]);

  const submit = async () => {
    if (!template || validation) return;
    setBusy(true); setError("");
    try {
      const result = await apiPost<{ proposalId: string }>(`/api/ads/campaigns/proposals?${query}`, {
        templateCampaignId: template.campaignId,
        name: name.trim(), budget: Number(budget), start: today(), end,
      });
      setProposalId(result.proposalId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the campaign draft.");
    } finally { setBusy(false); }
  };

  const launch = async () => {
    if (!proposalId) return;
    setBusy(true); setError("");
    try {
      const result = await apiPost<{ campaignId: string }>(`/api/ads/campaigns/proposals/${proposalId}/decide?${query}`, { action: "approve" });
      window.location.assign(`/dashboard/ads/campaigns/${result.campaignId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Blinkit could not launch this campaign.");
      setBusy(false);
    }
  };

  if (!template) return <button disabled title="A stopped or completed campaign is required as a safe template" className="inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold opacity-50" style={{ borderColor: "var(--border)" }}>+ Create campaign</button>;
  return <>
    <button onClick={show} className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>+ Create campaign</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,12,14,.62)", backdropFilter: "blur(3px)" }} role="dialog" aria-modal="true" aria-labelledby="create-campaign-title">
      <div className="w-full max-w-[600px] overflow-hidden rounded-2xl border shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-start gap-4 border-b px-6 py-5" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0 flex-1"><h2 id="create-campaign-title" className="text-lg font-semibold">Create Blinkit campaign</h2><p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Choose a proven campaign as template. Products, targeting, keywords and ad format will be copied.</p></div>
          <button onClick={() => !busy && setOpen(false)} aria-label="Close" className="rounded-lg p-1.5"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {proposalId ? <div className="rounded-xl border p-4" style={{ borderColor: "var(--ok)", background: "color-mix(in srgb, var(--ok) 7%, var(--surface))" }}><div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={17} /> Draft #{proposalId} saved</div><p className="mt-2 text-sm">Review the campaign below. Blinkit will create it only after you approve.</p></div> : <>
          <label className="grid gap-1.5"><span className="text-xs font-medium">Template campaign</span><select aria-label="Template campaign" className={inputClass} style={{ borderColor: "var(--border)" }} value={template.campaignId} onChange={(e) => { const row = templates.find((item) => item.campaignId === e.target.value); if (row) resetFrom(row); }}>{templates.map((row) => <option key={row.campaignId} value={row.campaignId}>{row.name} · {TYPE_LABEL[row.type] ?? row.type}</option>)}</select></label>
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg)" }}><div className="flex items-center gap-2 font-semibold"><Copy size={14} /> Copying #{template.campaignId}</div><div className="mt-1 flex gap-4" style={{ color: "var(--muted)" }}><span>{template.productIds.length} products</span><span>{inr(template.budget)} current budget</span></div></div>
          <label className="grid gap-1.5"><span className="text-xs font-medium">New campaign name</span><input aria-label="New campaign name" className={inputClass} style={{ borderColor: "var(--border)" }} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">Budget (₹)</span><input aria-label="Budget (₹)" className={inputClass} style={{ borderColor: "var(--border)" }} type="number" min="1" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label className="grid gap-1.5"><span className="text-xs font-medium">End date</span><input aria-label="End date" className={inputClass} style={{ borderColor: "var(--border)" }} type="date" min={today()} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </>}
          {(validation || error) && <div role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "color-mix(in srgb, var(--crit) 45%, var(--border))", color: "var(--crit)" }}>{error || validation}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "var(--border)", background: "var(--bg)" }}><button disabled={busy} onClick={() => setOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>{proposalId ? "Close" : "Cancel"}</button><button disabled={busy || (!proposalId && !!validation)} onClick={proposalId ? launch : submit} className="h-10 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>{busy ? (proposalId ? "Launching…" : "Saving…") : proposalId ? "Approve & launch" : "Save draft"}</button></div>
      </div>
    </div>}
  </>;
}
