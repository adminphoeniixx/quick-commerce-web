# Code architecture

## Ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| `app/**/page.tsx` | Route composition and page state | Prisma, business rules |
| `components/**` | Presentational and interaction components | Database access |
| `app/api/**/route.ts` | HTTP parsing, auth policy, response mapping | Domain workflows |
| `lib/<domain>/**` | Domain rules, use cases, read models | UI rendering |
| `lib/platform/**` | Shared DB, HTTP, queue, logging primitives | Product rules |
| `worker/**` | Job dispatch and lifecycle | Ad hoc feature logic |
| `services/browser/**` | Browser automation and provider adapters | QCP database writes |

## Request flow

```text
Page/component -> client API -> route -> use case -> repository/provider
Worker -> job handler -> use case -> repository/provider
```

## Domain folders

Keep related types, validation, use cases, queries, and tests together:

```text
lib/
  ads/
  analytics/
  auth/
  connections/
  ingest/
  marketplace/
  seo/
  platform/
```

## Refactor rules

1. Keep routes thin.
2. Keep Prisma calls inside domain query/repository modules.
3. Define shared DTOs once; import them in pages and routes.
4. Keep provider-specific code behind adapters.
5. Extract repeated pure logic into tested helpers.
6. Refactor one ownership boundary at a time.
7. Run typecheck and tests before and after each boundary move.

## Current migration order

1. Shared contracts and pure helpers.
2. Ingestion use cases and duplicate-row handling.
3. Ads workflows and campaign/bid boundaries.
4. Analytics read models.
5. Connection sync orchestration.
6. Worker job handlers.
7. Browser service modules.
