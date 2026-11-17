import { z } from "zod";
import type { BidAgentReview, BidRecommendation } from "./bid-recommendations";

const schema = z.object({ reviews: z.array(z.object({ id: z.string(), verdict: z.enum(["approve", "review", "skip"]), summary: z.string().max(400), risks: z.array(z.string().max(180)).max(4) })) });
const roles = [
  { role: "Performance agent", focus: "Check sample, spend, sales and ROAS support the bounded bid direction." },
  { role: "Growth agent", focus: "Check whether the action supports sales growth without claiming guaranteed lift." },
  { role: "Risk agent", focus: "Challenge weak evidence, margin risk, rapid bid changes and wasted spend." },
] as const;
function outputText(body: any) { return (body?.output ?? []).flatMap((x: any) => x.content ?? []).filter((x: any) => x.type === "output_text").map((x: any) => x.text ?? "").join("\n"); }
function parseJson(text: string) { return JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text); }
async function run(role: typeof roles[number], drafts: BidRecommendation[]): Promise<(BidAgentReview & { id: string })[]> {
  const key = process.env.MODEL_ACCESS_KEY?.trim(); if (!key) throw new Error("Bid analysis model is not configured");
  const base = (process.env.AI_INFERENCE_BASE_URL || "https://inference.do-ai.run/v1").replace(/\/$/, ""), model = process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b";
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const evidence = drafts.map(({ id, campaignId, campaignStatus, keyword, matchType, cpm, toCpm, changePct, impressions, spend, sales, atc, position, roas, confidence, objective }) => ({ id, campaignId, campaignStatus, keyword, matchType, currentCpm: cpm, proposedCpm: toCpm, changePct, impressions, spend, sales, atc, position, roas, confidence, objective }));
    const response = await fetch(`${base}/responses`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0, max_output_tokens: 2600, stream: false, input: [{ role: "system", content: `You are the ${role.role}. ${role.focus} Return JSON only: {"reviews":[{"id":"exact id","verdict":"approve|review|skip","summary":"seller-facing sentence","risks":["..."]}]}. Never change bids or metrics. Never promise sales or profit. Approve only controlled changes supported by supplied evidence.` }, { role: "user", content: JSON.stringify(evidence) }] }) });
    if (!response.ok) throw new Error(`Bid agent upstream HTTP ${response.status}`);
    const returned = schema.parse(parseJson(outputText(await response.json()))).reviews;
    return drafts.map((draft) => { const found = returned.filter((item) => item.id === draft.id); return found.length === 1 ? { role: role.role, ...found[0] } : { id: draft.id, role: role.role, verdict: "skip" as const, summary: "Specialist review incomplete; recommendation blocked.", risks: ["Incomplete AI review"] }; });
  } finally { clearTimeout(timer); }
}

export async function analyzeBidRecommendations(drafts: BidRecommendation[]) {
  if (!drafts.length) return { recommendations: drafts, mode: "not-needed" as const, model: null };
  try {
    const reviews = (await Promise.all(roles.map((role) => run(role, drafts)))).flat();
    return { recommendations: drafts.map((draft) => { const own = reviews.filter((item) => item.id === draft.id).map(({ id: _id, ...item }) => item); const complete = new Set(own.map((item) => item.role)).size === roles.length; const verdict = !complete || own.some((item) => item.verdict === "skip") ? "skip" as const : own.every((item) => item.verdict === "approve") ? "approve" as const : "review" as const; return { ...draft, agentConsensus: { verdict, summary: verdict === "approve" ? "All specialists support this controlled bid change." : verdict === "review" ? "Review trade-offs before approval." : "Specialists found insufficient evidence or material risk.", reviews: own } }; }), mode: "multi-agent" as const, model: process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b" };
  } catch (error) {
    console.error("[bid-agents] fallback:", error instanceof Error ? error.message : error);
    return { recommendations: drafts.map((draft) => ({ ...draft, agentConsensus: { verdict: "review" as const, summary: "AI specialists unavailable. Deterministic safety rule only; manual review required.", reviews: [] } })), mode: "deterministic-fallback" as const, model: null };
  }
}
