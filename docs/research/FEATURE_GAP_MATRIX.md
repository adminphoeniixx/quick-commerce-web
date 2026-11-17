# Feature gap matrix

| Capability | Status | Evidence / blocker |
|---|---|---|
| Authorized file ingestion | Partial | Existing code and unit tests; DB integration skipped |
| Marketplace observation schema | Done | Additive migration 0009 |
| Product listing/detail | Done at build level | Tenant-scoped API and UI routes |
| MCP foundation | Partial | Stdio server, schemas, health/validation/matching/search tools |
| Direct Blinkit/Zepto/Instamart scraping | Blocked | Published platform restrictions |
| Authorized provider collection | Partial | Secure ingestion boundary; provider not selected/configured |
| BullMQ collection job | Not started | Existing queue is import-only |
| Live database verification | Blocked | PostgreSQL/Redis unavailable in sandbox |
| DCluttr interactive research | Blocked | No interactive browser session |
| Production readiness | Blocked | Live collection absent and dependency audit failures |
