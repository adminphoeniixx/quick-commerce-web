import { z } from "zod";
import type { AgentReview, CampaignSuggestion } from "./campaign-suggestions";

const reviewSchema = z.object({ reviews: z.array(z.object({ id: z.string(), verdict: z.enum(["launch", "review", "skip"]), summary: z.string().max(500), drivers: z.array(z.string().max(220)).max(5), risks: z.array(z.string().max(220)).max(5) })) });
const roles = [
  { role: "Performance agent", focus: "Evaluate sample size, ROAS distribution and whether the deterministic scenario is supported." },
  { role: "Growth agent", focus: "Explain seller benefit and practical upside without claiming causality or guaranteed revenue." },
  { role: "Risk agent", focus: "Challenge budget, overlap, attribution, stock and weak-data risks. Prefer review or skip when evidence is weak." },
] as const;
function outputText(body: any) { return (body?.output ?? []).flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === "output_text").map((item: any) => item.text ?? "").join("\n"); }
function json(text: string) { return JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text); }
async function runAgent(role: typeof roles[number], drafts: CampaignSuggestion[]): Promise<(AgentReview & { id: string })[]> {
  const key = process.env.MODEL_ACCESS_KEY?.trim(); if (!key) throw new Error("Campaign analysis model is not configured");
  const base = (process.env.AI_INFERENCE_BASE_URL || "https://inference.do-ai.run/v1").replace(/\/$/, ""), model = process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b";
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const evidence = drafts.map(({ id, templateName, type, productCount, budget, observedDays, spendDays, historicalSpend, historicalSales, historicalRoas, maximumSpend, projectedSales, projectedRoas, confidence, launchReady, assumptions, risks, salesTools }) => ({ id, templateName, type, productCount, budget, observedDays, spendDays, historicalSpend, historicalSales, historicalRoas, maximumSpend, projectedSales, projectedRoas, confidence, launchReady, assumptions, risks, salesTools }));
    const response = await fetch(`${base}/responses`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0, max_output_tokens: 2200, stream: false,
      input: [{ role: "system", content: `You are the ${role.role}. ${role.focus} Return JSON only: {"reviews":[{"id":"exact input id","verdict":"launch|review|skip","summary":"plain seller-facing sentence","drivers":["..."],"risks":["..."]}]}. Never change numbers, invent facts, claim profit, causality or guaranteed benefit. Low confidence or launchReady=false cannot receive launch verdict.` }, { role: "user", content: JSON.stringify(evidence) }] }) });
    if (!response.ok) throw new Error(`Campaign agent upstream HTTP ${response.status}`);
    const returned = reviewSchema.parse(json(outputText(await response.json()))).reviews;
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
