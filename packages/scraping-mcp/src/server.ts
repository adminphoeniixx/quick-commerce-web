import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { allAdapters, getAdapter } from "./adapters.js";
import { deterministicMatch } from "./normalize.js";
import { searchSchema } from "./contracts.js";
import { timingSafeEqual } from "node:crypto";
import { authorizedNormalizationSchema, normalizeAuthorizedPayload } from "./ai-normalizer.js";

function authorize(value: string): void {
  const expected = process.env.QCP_MCP_SERVICE_TOKEN;
  if (!expected || value.length !== expected.length) throw new Error("UNAUTHORIZED");
  if (!timingSafeEqual(Buffer.from(value), Buffer.from(expected))) throw new Error("UNAUTHORIZED");
}
function result(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }

export function createServer(): McpServer {
  const server = new McpServer({ name: "quick-commerce-scraping", version: "0.1.0" });
  server.registerTool("marketplace_search_products", { description: "Search through a permitted, configured marketplace source", inputSchema: searchSchema.shape }, async (input) => {
    authorize(input.authorization);
    const parsed = searchSchema.parse(input);
    return result(await getAdapter(parsed.platform).searchProducts(parsed));
  });
  server.registerTool("marketplace_get_platform_health", { description: "Return policy/configuration health for marketplace adapters", inputSchema: { authorization: z.string().min(20) } }, async ({ authorization }) => {
    authorize(authorization);
    return result({ platforms: await Promise.all(allAdapters().map(async a => ({ platform: a.platform, ...(await a.checkAvailability()) }))) });
  });
  server.registerTool("marketplace_validate_observations", { description: "Validate normalized observation records without fetching URLs", inputSchema: { authorization: z.string().min(20), observations: z.array(z.unknown()).max(1000) } }, async ({ authorization, observations }) => {
    authorize(authorization);
    const { observationSchema } = await import("./contracts.js");
    const validation = observations.map((item, index) => { const r = observationSchema.safeParse(item); return r.success ? { index, valid: true } : { index, valid: false, errors: r.error.issues.map(i => i.message) }; });
    return result({ valid: validation.every(v => v.valid), validation });
  });
  server.registerTool("marketplace_match_products", { description: "Deterministically compare two normalized products; incompatible pack sizes never match", inputSchema: { authorization: z.string().min(20), source: z.object({ title: z.string(), brand: z.string().optional(), packSize: z.string().optional() }), target: z.object({ title: z.string(), brand: z.string().optional(), packSize: z.string().optional() }) } }, async ({ authorization, source, target }) => {
    authorize(authorization); const confidence = deterministicMatch(source, target);
    return result({ confidence, status: confidence === 1 ? "EXACT" : "REVIEW_REQUIRED" });
  });
  server.registerTool("marketplace_normalize_authorized_payload", {
    description: "Use the configured AI model to normalize records already obtained from an authorized seller export or API. This tool does not browse, log in, bypass controls, or fetch arbitrary URLs.",
    inputSchema: authorizedNormalizationSchema.shape,
  }, async (input) => {
    authorize(input.authorization);
    const parsed = authorizedNormalizationSchema.parse(input);
    return result(await normalizeAuthorizedPayload(parsed));
  });
  return server;
}
