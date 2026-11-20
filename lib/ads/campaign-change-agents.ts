// Specialist review for campaign budget / restart / stop changes. Same pattern as the bid agents:
// three independent roles, JSON only, fail-closed (a missing or "skip" review blocks the change).
import { z } from "zod";
import type { CampaignChangeDraft } from "./keyword-growth";

export interface ChangeAgentReview { role: string; verdict: "approve" | "review" | "skip"; summary: string; risks: string[] }
export type ReviewedCampaignChange = CampaignChangeDraft & { agentConsensus: { verdict: "approve" | "review" | "skip"; summary: string; reviews: ChangeAgentReview[] } };

const reviewSchema = z.object({ id: z.string(), verdict: z.enum(["approve", "review", "skip"]), summary: z.string(), risks: z.array(z.string()) });
const responseSchema = z.object({ reviews: z.array(z.unknown()) });
const roles = [
  { role: "Performance agent", focus: "Check that spend, sales and ROAS over 14 and 30 days support the proposed budget change, restart or stop." },
  { role: "Growth agent", focus: "Check whether the change grows attributed sales (or stops waste) without claiming guaranteed lift." },
  { role: "Risk agent", focus: "Challenge budget overspend, stock risk, short samples, and for a stop: whether it would cut sales that matter." },
] as const;
const outputText = (body: any) => body?.choices?.[0]?.message?.content ?? "";
const parseJson = (text: string) => JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text);

export function normalizeChangeAgentResponse(value: unknown) {
  return responseSchema.parse(value).reviews.flatMap((item) => {
    const parsed = reviewSchema.safeParse(item);
    return parsed.success ? [{ ...parsed.data, summary: parsed.data.summary.slice(0, 400), risks: parsed.data.risks.slice(0, 4).map((t) => t.slice(0, 180)) }] : [];
  });
}

/** Fail-closed consensus: every role must review; any skip blocks; all approve ⇒ approve. */
export function changeConsensus(reviews: ChangeAgentReview[]) {
  const complete = roles.every((r) => reviews.some((x) => x.role === r.role));
  const verdict = !complete || reviews.some((r) => r.verdict === "skip") ? "skip" as const : reviews.every((r) => r.verdict === "approve") ? "approve" as const : "review" as const;
  return { verdict, summary: verdict === "approve" ? "All specialists support this campaign change." : verdict === "review" ? "Review trade-offs before approval." : "Specialists found insufficient evidence or material risk.", reviews };
}

async function run(role: typeof roles[number], drafts: CampaignChangeDraft[]): Promise<(ChangeAgentReview & { id: string })[]> {
  const key = process.env.MODEL_ACCESS_KEY?.trim(); if (!key) throw new Error("Campaign change model is not configured");
  const base = (process.env.AI_INFERENCE_BASE_URL || "https://inference.do-ai.run/v1").replace(/\/$/, ""), model = process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b";
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const evidence = drafts.map(({ id, kind, name, currentStatus, currentBudget, toBudget, reason, evidence, keywords, roas14, roas30, spend14, budgetUse }) => ({ id, kind, name, currentStatus, currentBudget, toBudget, reason, evidence, keywords: keywords.slice(0, 5), roas14, roas30, spend14, budgetUse }));
    const response = await fetch(`${base}/chat/completions`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0, max_tokens: 2000, stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: `You are the ${role.role}. ${role.focus} Return JSON only: {"reviews":[{"id":"exact id","verdict":"approve|review|skip","summary":"seller-facing sentence","risks":["..."]}]}. Never change budgets or metrics. Never promise sales or profit. Approve only changes supported by the supplied evidence.` }, { role: "user", content: JSON.stringify(evidence) }] }) });
    if (!response.ok) throw new Error(`Campaign change agent upstream HTTP ${response.status}`);
    const returned = normalizeChangeAgentResponse(parseJson(outputText(await response.json())));
    return drafts.map((draft) => { const found = returned.filter((r) => r.id === draft.id); return found.length === 1 ? { role: role.role, ...found[0] } : { id: draft.id, role: role.role, verdict: "skip" as const, summary: "Specialist review incomplete; change blocked.", risks: ["Incomplete AI review"] }; });
  } finally { clearTimeout(timer); }
}

export async function analyzeCampaignChanges(drafts: CampaignChangeDraft[]): Promise<{ changes: ReviewedCampaignChange[]; mode: string; model: string | null }> {
  if (!drafts.length) return { changes: [], mode: "not-needed", model: null };
  try {
    const reviews = (await Promise.all(roles.map((role) => run(role, drafts)))).flat();
    return { changes: drafts.map((d) => ({ ...d, agentConsensus: changeConsensus(reviews.filter((r) => r.id === d.id).map(({ id: _id, ...r }) => r)) })), mode: "multi-agent", model: process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b" };
  } catch (error) {
    console.error("[campaign-change-agents] fallback:", error instanceof Error ? error.message : error);
    return { changes: drafts.map((d) => ({ ...d, agentConsensus: { verdict: "review" as const, summary: "AI specialists unavailable. Deterministic rule only; manual review required.", reviews: [] } })), mode: "deterministic-fallback", model: null };
  }
}
