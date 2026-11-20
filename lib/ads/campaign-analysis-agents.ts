import { z } from "zod";
import type { AgentReview, CampaignSuggestion } from "./campaign-suggestions";

const reviewSchema = z.object({ id: z.string(), verdict: z.enum(["launch", "review", "skip"]), summary: z.string(), drivers: z.array(z.string()), risks: z.array(z.string()) });
const responseSchema = z.object({ reviews: z.array(z.unknown()) });
const roles = [
  { role: "Performance agent", focus: "Evaluate sample size, ROAS distribution and whether the deterministic scenario is supported." },
  { role: "Growth agent", focus: "Explain seller benefit and practical upside without claiming causality or guaranteed revenue." },
  { role: "Risk agent", focus: "Challenge budget, overlap, attribution, stock and weak-data risks. Prefer review or skip when evidence is weak." },
] as const;
function outputText(body: any) { return body?.choices?.[0]?.message?.content ?? ""; }
function json(text: string) { return JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text); }
export function normalizeCampaignAgentResponse(value: unknown) {
  return responseSchema.parse(value).reviews.flatMap((item) => {
    const parsed = reviewSchema.safeParse(item);
    return parsed.success ? [{ ...parsed.data, summary: parsed.data.summary.slice(0, 500), drivers: parsed.data.drivers.slice(0, 5).map((text) => text.slice(0, 220)), risks: parsed.data.risks.slice(0, 5).map((text) => text.slice(0, 220)) }] : [];
  });
}
async function runAgent(role: typeof roles[number], drafts: CampaignSuggestion[]): Promise<(AgentReview & { id: string })[]> {
  const key = process.env.MODEL_ACCESS_KEY?.trim(); if (!key) throw new Error("Campaign analysis model is not configured");
  const base = (process.env.AI_INFERENCE_BASE_URL || "https://inference.do-ai.run/v1").replace(/\/$/, ""), model = process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b";
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const evidence = drafts.map(({ id, templateName, type, productCount, budget, observedDays, spendDays, historicalSpend, historicalSales, historicalRoas, maximumSpend, projectedSales, projectedRoas, confidence, launchReady, assumptions, risks, salesTools, pastOutcomes, marketInsights }) => ({ id, templateName, type, productCount, budget, observedDays, spendDays, historicalSpend, historicalSales, historicalRoas, maximumSpend, projectedSales, projectedRoas, confidence, launchReady, assumptions, risks, salesTools, ...(pastOutcomes?.length ? { pastOutcomes } : {}), ...(marketInsights?.length ? { marketInsights } : {}) }));
    const response = await fetch(`${base}/chat/completions`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0, max_tokens: 2200, stream: false, response_format: { type: "json_object" },
      messages: [{ role: "system", content: `You are the ${role.role}. ${role.focus} Return JSON only: {"reviews":[{"id":"exact input id","verdict":"launch|review|skip","summary":"plain seller-facing sentence","drivers":["..."],"risks":["..."]}]}. Never change numbers, invent facts, claim profit, causality or guaranteed benefit. Low confidence or launchReady=false cannot receive launch verdict. When pastOutcomes is present, weigh what earlier launches from the same template actually achieved (salesDelta vs forecastHigh, ROAS). marketInsights are learned from blinkit.com search history for the campaign's top keywords (correlational: rank, price-gap and competitor stock-out sensitivity); weigh them by confidence.` }, { role: "user", content: JSON.stringify(evidence) }] }) });
    if (!response.ok) throw new Error(`Campaign agent upstream HTTP ${response.status}`);
    const returned = normalizeCampaignAgentResponse(json(outputText(await response.json())));
    return drafts.map((draft) => { const matches = returned.filter((review) => review.id === draft.id); return matches.length === 1
      ? { role: role.role, ...matches[0] }
      : { id: draft.id, role: role.role, verdict: "skip" as const, summary: `${role.role} returned an incomplete or duplicate review; launch is blocked.`, drivers: [], risks: ["Incomplete specialist analysis"] }; });
  } finally { clearTimeout(timer); }
}
export async function analyzeWithAgents(drafts: CampaignSuggestion[]) {
  if (!drafts.length) return { suggestions: drafts, mode: "not-needed" as const, model: null };
  try {
    const reviews = (await Promise.all(roles.map((role) => runAgent(role, drafts)))).flat();
    return { suggestions: drafts.map((draft) => { const own = reviews.filter((review) => review.id === draft.id).map(({ id: _id, ...review }) => review); const uniqueRoles = new Set(own.map((review) => review.role)); const complete = uniqueRoles.size === roles.length && roles.every((role) => uniqueRoles.has(role.role)); const launch = own.filter((r) => r.verdict === "launch").length, skip = own.filter((r) => r.verdict === "skip").length;
      const verdict = !draft.launchReady || !complete || skip > 0 ? "skip" as const : launch === roles.length ? "launch" as const : "review" as const;
      return { ...draft, agentConsensus: { verdict, summary: verdict === "launch" ? "Specialist agents agree this is suitable for a controlled test." : verdict === "review" ? "Agents recommend human review before launch." : "Agents found insufficient evidence or material risk; launch is blocked.", reviews: own } }; }), mode: "multi-agent" as const, model: process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b" };
  } catch (error) {
    console.error("[campaign-agents] fallback:", error instanceof Error ? error.message : error);
    return { suggestions: drafts.map((draft) => ({ ...draft, agentConsensus: { verdict: "skip" as const, summary: "LLM specialists were unavailable; launch is blocked until all agents complete.", reviews: [] } })), mode: "deterministic-fallback" as const, model: null };
  }
}
