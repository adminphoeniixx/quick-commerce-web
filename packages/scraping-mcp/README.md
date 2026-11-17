# Quick Commerce Scraping MCP

Fail-closed stdio MCP service for permitted marketplace collection. Set a strong `QCP_MCP_SERVICE_TOKEN` and run `npm run scraping:mcp`.

Current consumer adapters report `UNSUPPORTED_WITHOUT_WRITTEN_AUTHORIZATION` based on published platform terms. The authorized-feed adapter remains disabled until a provider-specific contract is reviewed and configured. Inputs cannot request arbitrary URLs.

## AI normalization

Set `MODEL_ACCESS_KEY`, `AI_INFERENCE_BASE_URL=https://inference.do-ai.run/v1`, and
`AI_NORMALIZER_MODEL=openai-gpt-oss-120b` to enable
`marketplace_normalize_authorized_payload`. The tool only transforms records that
were already obtained through an authorized seller export or API. It does not log
in to a marketplace, browse pages, bypass CAPTCHA/rate limits, or turn a restricted
adapter into a supported connector. All model output is validated against the
observation schema before it can be returned for ingestion.
