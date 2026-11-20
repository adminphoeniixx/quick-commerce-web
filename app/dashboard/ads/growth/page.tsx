"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdsShell, inr, type AdsCtx } from "@/components/ads/AdsShell";
import { Card } from "@/components/Card";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";

interface Goal { id: string; targetSalesGrowthPct: number; maxDailyAdSpend: number; minimumRoas: number; horizonDays: number; autopilot: boolean; replanEveryDays: number; notifyEmail: string | null }
interface Action { id: string; type: "BID" | "CAMPAIGN" | "CAMPAIGN_CHANGE"; title: string; status: string; error: string | null; reason: string; expectedImpact: string; confidence: string; evidence: string[]; currentValue: number | null; proposedValue: number | null; forecastSalesDelta: { low: number; high: number } }
interface Outcome { measurementStatus: string; elapsedDays: number; horizonDays: number; attributedSales: number; spend: number; roas: number | null; comparableBaselineSales: number; salesChangePct: number | null; treatedCampaigns?: number; treatedGrowthPct?: number | null; controlGrowthPct?: number | null; estimatedLiftPct?: number | null; newCampaignSales?: number; forecastLowToDate?: number; forecastHighToDate?: number; forecastVerdict?: string; runRateProjection?: number; targetSales?: number; onTrackForTarget?: boolean; expectedCompleteAt?: string }
interface Plan {
  id: string; status: string; trigger: string; error: string | null; createdAt: string; createdBy: string; dataAsOf: string | null; approvedBy: string | null; materializedAt: string | null; measuredAt: string | null; completedAt: string | null;
  baseline: { from: string; to: string; spend: number; attributedSales: number; roas: number | null } | null;
  forecast: { targetSales: number; projectedAttributedSalesLow: number; projectedAttributedSalesHigh: number; warnings: string[]; plannedAdditionalDailyBudget?: number } | null;
  agentReviews: { bid: { reviewed: number; approved: number; mode: string }; campaign: { reviewed: number; approved: number; mode: string } } | null;
  actions: Action[]; outcome: Outcome | null;
}

interface MarketRow { keyword: string; sampleDays: number; confidence: string; meanDailySales: number; avgOrganicRank: number | null; rankSensitivityPct: number | null; avgPriceGapPct: number | null; priceSensitivityPct: number | null; stockoutUpliftPct: number | null; adShareTop10: number | null }
interface Learning { market: MarketRow[]; totalOutcomes: number; planOutcomes: number; historicalOutcomes: number; calibration: { type: string; direction: string; sampleSize: number; rawRatio: number; factor: number }[]; recent: { planId: string | null; source: string; when: string; type: string; direction: string; changePct: number | null; keyword: string | null; campaignId: string | null; salesDelta: number; forecastHigh: number; forecastRatio: number | null }[] }
const input = "h-10 rounded-lg border bg-transparent px-3 text-sm";
const RUNNING = ["QUEUED", "RESEARCHING", "WAITING_FOR_DATA"];
const tone: Record<string, string> = { DRAFT: "var(--accent)", APPROVED: "var(--accent)", MATERIALIZED: "var(--accent)", COMPLETED: "var(--ok, var(--accent))", LIVE: "var(--ok, var(--accent))", FAILED: "var(--crit)", BLOCKED: "var(--crit)", REJECTED: "var(--muted)", DISCARDED: "var(--muted)", EXPIRED: "var(--muted)", SUPERSEDED: "var(--muted)", QUEUED: "var(--warn)", RESEARCHING: "var(--warn)", WAITING_FOR_DATA: "var(--warn)" };
const Badge = ({ s }: { s: string }) => <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: tone[s] ?? "var(--border)", color: tone[s] ?? "var(--muted)" }}>{s === "WAITING_FOR_DATA" ? "waiting for web data" : s.toLowerCase()}</span>;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function GrowthView({ brandId }: AdsCtx) {
  const [learning, setLearning] = useState<Learning | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null), [plans, setPlans] = useState<Plan[]>([]), [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [picked, setPicked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ targetSalesGrowthPct: 20, maxDailyAdSpend: 5000, minimumRoas: 2, horizonDays: 30, autopilot: false, replanEveryDays: 7, notifyEmail: "" });
  const q = `brandId=${brandId}`;

  // fresh: bypass apiGet's 250 ms GET dedupe so a reload right after a mutation never returns pre-mutation data.
  const load = useCallback(async (fresh = false) => {
    const t = fresh ? `&_t=${Date.now()}` : "";
    try {
      const [g, p, l] = await Promise.all([apiGet<{ goal: Goal | null }>(`/api/ads/growth/goal?${q}${t}`), apiGet<{ plans: Plan[] }>(`/api/ads/growth/plans?${q}${t}`), apiGet<Learning>(`/api/ads/growth/learning?${q}${t}`).catch(() => null)]);
      setGoal(g.goal); setPlans(p.plans); setLearning(l);
      if (g.goal) setForm({ targetSalesGrowthPct: Number(g.goal.targetSalesGrowthPct), maxDailyAdSpend: Number(g.goal.maxDailyAdSpend), minimumRoas: Number(g.goal.minimumRoas), horizonDays: g.goal.horizonDays, autopilot: g.goal.autopilot, replanEveryDays: g.goal.replanEveryDays, notifyEmail: g.goal.notifyEmail ?? "" });
    } catch (e) { setError(msg(e, "Could not load growth plans")); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const plan = useMemo(() => plans.find((p) => p.id === selectedId) ?? plans[0], [plans, selectedId]);
  const running = plans.some((p) => RUNNING.includes(p.status));

  // Poll while research runs in the worker.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { load(true); }, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  // Default selection: every action in a fresh draft.
  useEffect(() => { if (plan?.status === "DRAFT") setPicked(new Set(plan.actions.map((a) => a.id))); }, [plan?.id, plan?.status]);

  const run = async (fn: () => Promise<unknown>, fallback: string) => { setBusy(true); setError(""); try { await fn(); await load(true); } catch (e) { setError(msg(e, fallback)); } finally { setBusy(false); } };
  const validForm = form.targetSalesGrowthPct >= 1 && form.maxDailyAdSpend > 0 && form.minimumRoas >= 0.1 && form.horizonDays >= 7 && form.horizonDays <= 90 && form.replanEveryDays >= 1 && form.replanEveryDays <= 30;
  // Use the POST response directly: apiGet dedupes identical GETs for 250 ms, so an immediate reload could return the pre-save goal.
  const save = async () => { setBusy(true); setError(""); try { const saved = await apiPost<{ goal: Goal }>(`/api/ads/growth/goal?${q}`, { ...form, notifyEmail: form.notifyEmail.trim() || null }); setGoal(saved.goal); } catch (e) { setError(msg(e, "Could not save goal")); } finally { setBusy(false); } };
  const generate = () => run(async () => { const r = await apiPost<{ plan: { id: string } }>(`/api/ads/growth/plans?${q}`); setSelectedId(r.plan.id); }, "Could not queue plan");
  const approve = (p: Plan) => run(() => apiPost(`/api/ads/growth/plans/${p.id}/decide?${q}`, { action: "approve", actionIds: [...picked] }), "Could not approve plan");
  const reject = (p: Plan) => run(() => apiPost(`/api/ads/growth/plans/${p.id}/decide?${q}`, { action: "reject" }), "Could not reject plan");
  const step = (p: Plan, action: "materialize" | "measure") => run(() => apiPost(`/api/ads/growth/plans/${p.id}/${action}?${q}`), `Could not ${action} plan`);

  const numberFields = [["targetSalesGrowthPct", "Target sales growth (%)"], ["maxDailyAdSpend", "Maximum daily ad spend (₹)"], ["minimumRoas", "Minimum ROAS"], ["horizonDays", "Planning horizon (days)"]] as const;
  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--crit)", color: "var(--crit)" }}>{error}</p>}

    <Card title="Sales-growth objective" subtitle="Agents optimize attributed sales within your spend and ROAS guardrails. Nothing reaches Blinkit without human approval.">
      <div className="grid gap-3 md:grid-cols-4">{numberFields.map(([key, label]) => <label key={key} className="grid gap-1 text-xs"><span>{label}</span><input className={input} style={{ borderColor: "var(--border)" }} type="number" value={form[key]} onChange={(e) => setForm((o) => ({ ...o, [key]: Number(e.target.value) }))} /></label>)}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.autopilot} onChange={(e) => setForm((o) => ({ ...o, autopilot: e.target.checked }))} /><span>Autopilot: research a new plan automatically</span></label>
        <label className="grid gap-1 text-xs"><span>Re-plan every (days)</span><input className={input} style={{ borderColor: "var(--border)" }} type="number" disabled={!form.autopilot} value={form.replanEveryDays} onChange={(e) => setForm((o) => ({ ...o, replanEveryDays: Number(e.target.value) }))} /></label>
        <label className="grid gap-1 text-xs md:col-span-2"><span>Notify email (plan ready, failed, completed)</span><input className={input} style={{ borderColor: "var(--border)" }} type="email" placeholder="Defaults to whoever generated the plan" value={form.notifyEmail} onChange={(e) => setForm((o) => ({ ...o, notifyEmail: e.target.value }))} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={busy || !validForm} onClick={save} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--plane)" }}>Save objective</button>
        <button disabled={busy || !goal || running} onClick={generate} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>{running ? "Agents researching…" : "Generate agentic plan"}</button>
      </div>
    </Card>

    {plan && <Card title={`Growth plan #${plan.id}`} subtitle={[plan.trigger === "autopilot" ? "Autopilot" : `By ${plan.createdBy}`, plan.dataAsOf && `evidence through ${plan.dataAsOf}`, plan.agentReviews && `${plan.agentReviews.bid.mode} bid review · ${plan.agentReviews.campaign.mode} campaign review`].filter(Boolean).join(" · ")} right={<Badge s={plan.status} />}>
      {plan.status === "WAITING_FOR_DATA" && <p className="text-sm" style={{ color: "var(--muted)" }}>Waiting for fresh web data: agents asked for one blinkit.com search of your top keywords and will continue research automatically.</p>}
      {RUNNING.includes(plan.status) && plan.status !== "WAITING_FOR_DATA" && <p className="text-sm" style={{ color: "var(--muted)" }}>Specialist agents are researching bids, campaigns, ranking, inventory and pricing. This page updates automatically; you will be emailed when the plan is ready.</p>}
      {plan.error && <p className="mt-2 text-sm" style={{ color: ["FAILED"].includes(plan.status) ? "var(--crit)" : "var(--muted)" }}>{plan.error}</p>}

      {plan.baseline && plan.forecast && <>
        <div className="grid gap-2 text-sm md:grid-cols-4">{[["Baseline sales", inr(plan.baseline.attributedSales)], ["Target sales", inr(plan.forecast.targetSales)], ["Projected range", `${inr(plan.forecast.projectedAttributedSalesLow)}–${inr(plan.forecast.projectedAttributedSalesHigh)}`], ["Baseline ROAS", plan.baseline.roas == null ? "—" : `${plan.baseline.roas.toFixed(2)}x`]].map(([k, v]) => <div key={k} className="rounded-lg p-3" style={{ background: "var(--bg)" }}><small style={{ color: "var(--muted)" }}>{k}</small><b className="block">{v}</b></div>)}</div>
        {plan.forecast.warnings.map((x) => <p key={x} className="mt-2 text-xs" style={{ color: "var(--warn)" }}>• {x}</p>)}
      </>}

      {plan.actions.length > 0 && <div className="mt-4 space-y-2">{plan.actions.map((a) => <div key={a.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2">
            {plan.status === "DRAFT" && <input type="checkbox" checked={picked.has(a.id)} onChange={(e) => setPicked((old) => { const next = new Set(old); if (e.target.checked) next.add(a.id); else next.delete(a.id); return next; })} />}
            <b>{a.type} · {a.title}</b>
          </label>
          <span className="flex items-center gap-2 text-xs">{a.confidence && <span>{a.confidence} confidence</span>}<Badge s={a.status} /></span>
        </div>
        {a.currentValue != null && a.proposedValue != null && <p className="mt-1 text-xs">{a.type === "BID" ? "CPM" : "Daily budget"}: {inr(a.currentValue)} → <b>{inr(a.proposedValue)}</b></p>}
        <p className="mt-1">{a.reason}</p>
        <p className="mt-1 text-xs"><b>Expected attributed-sales change:</b> {inr(a.forecastSalesDelta.low)} to {inr(a.forecastSalesDelta.high)} over the horizon.</p>
        {a.expectedImpact && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{a.expectedImpact}</p>}
        {a.error && <p className="mt-1 text-xs" style={{ color: "var(--crit)" }}>{a.error}</p>}
        {a.evidence.length > 0 && <details className="mt-2 text-xs"><summary>Research evidence</summary><ul className="mt-1 list-disc pl-5">{a.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details>}
      </div>)}</div>}

      {plan.status === "DRAFT" && <div className="mt-4 flex flex-wrap items-center gap-2">
        <button disabled={busy || !picked.size} onClick={() => approve(plan)} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--plane)" }}>Approve {picked.size} of {plan.actions.length} action(s)</button>
        <button disabled={busy} onClick={() => reject(plan)} className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }}>Reject plan</button>
      </div>}
      {plan.status === "APPROVED" && <button disabled={busy} onClick={() => step(plan, "materialize")} className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--plane)" }}>Revalidate &amp; create approval drafts</button>}
      {(plan.status === "MATERIALIZED" || plan.status === "COMPLETED") && <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/dashboard/ads/bids">Approve bid actions</Link>
        <Link className="underline" href="/dashboard/ads/campaigns">Approve campaign actions</Link>
        <button disabled={busy} className="underline" onClick={() => step(plan, "measure")}>Measure now</button>
      </div>}

      {plan.outcome && <OutcomeView o={plan.outcome} measuredAt={plan.measuredAt} />}
    </Card>}

    <KeywordBoard q={q} version={plans[0]?.id ?? ""} />

    {learning && <LearningView l={learning} />}

    {plans.length > 1 && <Card title="Plan history" subtitle="Every researched plan, its decision and measured result.">
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1">Plan</th><th>Status</th><th>Created</th><th>Actions</th><th>Sales change</th><th>Lift</th></tr></thead>
        <tbody>{plans.map((p) => <tr key={p.id} className="cursor-pointer border-t" style={{ borderColor: "var(--border)", background: p.id === plan?.id ? "var(--bg)" : undefined }} onClick={() => setSelectedId(p.id)}>
          <td className="py-1.5">#{p.id}{p.trigger === "autopilot" ? " · auto" : ""}</td><td><Badge s={p.status} /></td><td>{new Date(p.createdAt).toLocaleDateString()}</td>
          <td>{p.actions.filter((a) => a.status === "LIVE").length}/{p.actions.length} live</td><td>{pct(p.outcome?.salesChangePct)}</td><td>{p.outcome?.estimatedLiftPct == null ? "—" : `${p.outcome.estimatedLiftPct.toFixed(1)} pts`}</td>
        </tr>)}</tbody></table></div>
    </Card>}
  </div>;
}

interface KwDecision { campaignId: string; campaignName: string; keyword: string; matchType: string; organicRank: number | null; adPosition: number | null; roas: number | null; spend: number; sales: number; budgetUse: number | null; sellableUnits: number | null; availabilityPct: number | null; decision: string; reason: string; bidChangePct: number | null }
const DECISION: Record<string, [string, string]> = { HOLD_STOCK: ["Fix stock", "var(--crit)"], BID_DOWN_ROAS: ["Bid down · weak ROAS", "var(--warn)"], BID_DOWN_ORGANIC: ["Bid down · protect organic", "var(--warn)"], BUDGET_UP: ["Raise campaign budget", "var(--accent)"], BID_UP: ["Bid up · win rank", "var(--accent)"], HOLD: ["Hold", "var(--muted)"] };
function KeywordBoard({ q, version }: { q: string; version: string }) {
  const [rows, setRows] = useState<KwDecision[] | null>(null), [filter, setFilter] = useState("ALL"), [error, setError] = useState("");
  useEffect(() => { apiGet<{ decisions: KwDecision[] }>(`/api/ads/growth/keywords?${q}`).then((r) => setRows(r.decisions)).catch((e) => setError(msg(e, "Could not load keyword board"))); }, [q, version]);
  if (error) return <p className="text-sm" style={{ color: "var(--crit)" }}>{error}</p>;
  if (!rows?.length) return null;
  const counts = Object.fromEntries(Object.keys(DECISION).map((k) => [k, rows.filter((r) => r.decision === k).length]));
  const shown = [...rows].filter((r) => filter === "ALL" || r.decision === filter).sort((a, b) => b.spend - a.spend);
  return <Card title="Keyword growth board" subtitle="Every keyword's rank and the agent's decision: fix stock, change bid, or raise the campaign budget. Generate a plan to turn decisions into approvable actions.">
    <div className="mb-3 flex flex-wrap gap-2 text-xs">{["ALL", ...Object.keys(DECISION)].map((k) => <button key={k} onClick={() => setFilter(k)} className="rounded-full border px-2.5 py-1" style={{ borderColor: filter === k ? "var(--accent)" : "var(--border)", color: k === "ALL" ? undefined : DECISION[k][1] }}>{k === "ALL" ? `All ${rows.length}` : `${DECISION[k][0]} ${counts[k]}`}</button>)}</div>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1">Keyword</th><th>Campaign</th><th>Organic rank</th><th>Ad position</th><th>ROAS</th><th>Spend · sales (14d)</th><th>Budget use</th><th>Stock</th><th>Decision</th></tr></thead>
      <tbody>{shown.slice(0, 100).map((r) => <tr key={`${r.campaignId}|${r.keyword}|${r.matchType}`} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
        <td className="py-1.5">{r.keyword} <span style={{ color: "var(--muted)" }}>{r.matchType}</span></td><td>{r.campaignName}</td><td>{r.organicRank ?? "—"}</td><td>{r.adPosition ?? "—"}</td><td>{r.roas == null ? "—" : `${r.roas.toFixed(2)}x`}</td>
        <td>{inr(r.spend)} · {inr(r.sales)}</td><td>{r.budgetUse == null ? "—" : `${Math.round(r.budgetUse * 100)}%`}</td><td>{r.sellableUnits ?? "—"}{r.availabilityPct != null ? ` · ${Math.round(r.availabilityPct)}%` : ""}</td>
        <td><b style={{ color: DECISION[r.decision]?.[1] }}>{DECISION[r.decision]?.[0] ?? r.decision}{r.bidChangePct != null ? ` ${r.bidChangePct > 0 ? "+" : ""}${r.bidChangePct}%` : ""}</b><div style={{ color: "var(--muted)" }}>{r.reason}</div></td>
      </tr>)}</tbody></table></div>
  </Card>;
}

const dirLabel: Record<string, string> = { "BID|increase": "Bid increases", "BID|decrease": "Bid decreases", "CAMPAIGN|launch": "Campaign launches", "CAMPAIGN|budget_up": "Budget increases", "CAMPAIGN|restart": "Campaign restarts", "CAMPAIGN|stop": "Campaign stops" };
function LearningView({ l }: { l: Learning }) {
  return <Card title="What the agents have learned" subtitle={l.totalOutcomes ? `${l.totalOutcomes} measured outcome(s): ${l.planOutcomes} from approved plans, ${l.historicalOutcomes} learned automatically from synced Ads history (half weight). Forecasts are corrected by these factors; safety gates never change.` : "Nothing learned yet. Agents learn automatically after each Blinkit Ads sync from past bid changes and launches, and from completed plans."}>
    {l.calibration.length > 0 && <div className="grid gap-2 text-sm md:grid-cols-3">{l.calibration.map((c) => <div key={`${c.type}|${c.direction}`} className="rounded-lg p-3" style={{ background: "var(--bg)" }}>
      <small style={{ color: "var(--muted)" }}>{dirLabel[`${c.type}|${c.direction}`] ?? `${c.type} ${c.direction}`}</small>
      <b className="block">Forecast × {c.factor.toFixed(2)}</b>
      <small style={{ color: "var(--muted)" }}>{c.sampleSize} outcome(s) · actual was {(c.rawRatio * 100).toFixed(0)}% of forecast</small>
    </div>)}</div>}
    {l.recent.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1">Source</th><th>Action</th><th>Forecast (high)</th><th>Actual lift</th><th>Accuracy</th></tr></thead>
      <tbody>{l.recent.map((o) => <tr key={`${o.planId ?? o.source}-${o.when}-${o.type}-${o.keyword ?? o.campaignId}`} className="border-t" style={{ borderColor: "var(--border)" }}>
        <td className="py-1.5">{o.planId ? `Plan #${o.planId}` : "History"} · {o.when}</td><td>{o.type === "BID" ? `Bid ${o.direction}${o.changePct == null ? "" : ` ${o.changePct > 0 ? "+" : ""}${o.changePct.toFixed(0)}%`} · ${o.keyword}` : o.planId ? `Launch from ${o.campaignId}` : `Launch · ${o.campaignId}`}</td>
        <td>{inr(o.forecastHigh)}</td><td>{inr(o.salesDelta)}</td><td>{o.forecastRatio == null ? "—" : `${(o.forecastRatio * 100).toFixed(0)}%`}</td>
      </tr>)}</tbody></table></div>}
    {l.market.length > 0 && <div className="mt-4">
      <b className="text-sm">Market insights from blinkit.com search history</b>
      <p className="text-xs" style={{ color: "var(--muted)" }}>Correlations learned per keyword; agents weigh them by confidence. They never change a bid or a safety gate.</p>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr style={{ color: "var(--muted)" }}><th className="py-1">Keyword</th><th>Days</th><th>Confidence</th><th>Avg organic rank</th><th>Sales per rank worse</th><th>Price gap</th><th>Sales per +1 pt price</th><th>Competitor stock-out lift</th><th>Ads in top 10</th></tr></thead>
        <tbody>{l.market.map((m) => <tr key={m.keyword} className="border-t" style={{ borderColor: "var(--border)" }}>
          <td className="py-1.5">{m.keyword}</td><td>{m.sampleDays}</td><td>{m.confidence}</td><td>{m.avgOrganicRank ?? "—"}</td><td>{pct(m.rankSensitivityPct)}</td><td>{pct(m.avgPriceGapPct)}</td><td>{pct(m.priceSensitivityPct)}</td><td>{pct(m.stockoutUpliftPct)}</td><td>{m.adShareTop10 == null ? "—" : `${Math.round(m.adShareTop10 * 100)}%`}</td>
        </tr>)}</tbody></table></div>
    </div>}
  </Card>;
}

function OutcomeView({ o, measuredAt }: { o: Outcome; measuredAt: string | null }) {
  const verdict = o.forecastVerdict === "BELOW_FORECAST" ? ["Below forecast", "var(--crit)"] : o.forecastVerdict === "ABOVE_FORECAST" ? ["Above forecast", "var(--accent)"] : o.forecastVerdict ? ["Within forecast", "var(--accent)"] : null;
  return <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
    <div className="flex flex-wrap items-center justify-between gap-2"><b>Measured outcome · day {o.elapsedDays} of {o.horizonDays}</b>{verdict && <span className="text-xs font-semibold" style={{ color: verdict[1] }}>{verdict[0]}</span>}</div>
    <div className="mt-2 grid gap-2 md:grid-cols-4">{[
      ["Attributed sales", inr(o.attributedSales)], ["vs comparable baseline", pct(o.salesChangePct)], ["Spend · ROAS", `${inr(o.spend)} · ${o.roas == null ? "—" : `${o.roas.toFixed(2)}x`}`],
      ["Forecast to date", o.forecastLowToDate == null ? "—" : `${inr(o.forecastLowToDate)}–${inr(o.forecastHighToDate ?? 0)}`],
      ["Plan campaigns growth", pct(o.treatedGrowthPct)], ["Other campaigns growth", pct(o.controlGrowthPct)], ["Estimated lift", o.estimatedLiftPct == null ? "—" : `${o.estimatedLiftPct.toFixed(1)} pts`],
      ["Run-rate vs target", o.runRateProjection == null ? "—" : `${inr(o.runRateProjection)} / ${inr(o.targetSales ?? 0)}`],
    ].map(([k, v]) => <div key={k} className="rounded-lg p-2" style={{ background: "var(--bg)" }}><small style={{ color: "var(--muted)" }}>{k}</small><b className="block">{v}</b></div>)}</div>
    <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>Lift compares campaigns this plan changed against untouched campaigns over the same days, removing market-wide movement. {measuredAt && `Last measured ${new Date(measuredAt).toLocaleString()}.`} {o.measurementStatus !== "COMPLETE" && o.expectedCompleteAt && `Final result on ${o.expectedCompleteAt}; measured automatically every 6 hours.`}</p>
  </div>;
}

export default function GrowthPage() { return <AdsShell title="Sales growth plan" subtitle="One researched plan across campaigns, bids, ranking, inventory and pricing." dated={false} allowEmpty>{(ctx) => <GrowthView {...ctx} />}</AdsShell>; }
