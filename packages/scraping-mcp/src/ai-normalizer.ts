import { z } from "zod";
import { observationSchema, platformSchema, type Observation, type Platform } from "./contracts.js";

const responseSchema = z.object({
  status: z.string(),
  output: z.array(z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).optional(),
});

function configuration() {
  const apiKey = process.env.MODEL_ACCESS_KEY?.trim();
  if (!apiKey) throw new Error("AI_NORMALIZER_NOT_CONFIGURED: MODEL_ACCESS_KEY is missing");
  return {
    apiKey,
    baseUrl: (process.env.AI_INFERENCE_BASE_URL || "https://inference.do-ai.run/v1").replace(/\/$/, ""),
    model: process.env.AI_NORMALIZER_MODEL || "openai-gpt-oss-120b",
  };
}

function outputText(payload: unknown): string {
  const parsed = responseSchema.parse(payload);
  return (parsed.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === "output_text" && item.text)
    .map(item => item.text)
    .join("\n");
}

function jsonPayload(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse((fenced || text).trim());
}

export async function normalizeAuthorizedPayload(input: {
  platform: Platform;
  sourceUrl: string;
  observedAt: string;
  records: unknown[];
}): Promise<{ model: string; observations: Observation[]; rejected: Array<{ index: number; errors: string[] }> }> {
  const cfg = configuration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${cfg.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_output_tokens: 4096,
        stream: false,
        input: [
          { role: "system", content: "You normalize authorized quick-commerce seller exports. Return JSON only: an array. Never invent missing values. Each item must contain platformProductId, productUrl, title, sellingPrice, availability, observedAt, sourceUrl; optional brand, category, subcategory, imageUrl, packSize, unit, mrp, rank, placementType. availability is IN_STOCK, OUT_OF_STOCK, or UNKNOWN. placementType is ORGANIC, SPONSORED, or UNKNOWN." },
          { role: "user", content: JSON.stringify({ platform: input.platform, sourceUrl: input.sourceUrl, observedAt: input.observedAt, records: input.records }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI_NORMALIZER_UPSTREAM_ERROR: HTTP ${response.status}`);
    const body = await response.json();
    const text = outputText(body);
    if (!text) throw new Error("AI_NORMALIZER_EMPTY_RESPONSE");
    const candidates = z.array(z.unknown()).parse(jsonPayload(text));
    const observations: Observation[] = [];
    const rejected: Array<{ index: number; errors: string[] }> = [];
    candidates.forEach((candidate, index) => {
      const enforced = typeof candidate === "object" && candidate !== null
        ? { ...candidate, sourceUrl: input.sourceUrl, observedAt: input.observedAt }
        : candidate;
      const result = observationSchema.safeParse(enforced);
      if (result.success) observations.push(result.data);
      else rejected.push({ index, errors: result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) });
    });
    return { model: cfg.model, observations, rejected };
  } finally {
    clearTimeout(timeout);
  }
}

export const authorizedNormalizationSchema = z.object({
  authorization: z.string().min(20),
  authorized: z.literal(true),
  platform: platformSchema,
  sourceUrl: z.string().url().max(2048),
  observedAt: z.string().datetime(),
  records: z.array(z.unknown()).min(1).max(50),
});
