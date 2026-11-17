# Existing implementation audit

Audited 2026-10-28. The repository was inspected and the baseline commands were executed; claims below distinguish observed behavior from reported behavior.

| Feature | Exists | Functional | Real data | Tested | Missing work |
|---|---:|---:|---:|---:|---|
| Next.js application | Yes | Verified working | N/A | Next 16 production build and browser E2E passed | Production-host verification |
| Authentication/RBAC | Yes | Verified by integration suite | PostgreSQL | Passed | Browser E2E verification |
| Tenant isolation | Yes | Verified by integration suite | PostgreSQL | Passed | Marketplace-specific isolation E2E |
| Prisma/PostgreSQL | Yes | Verified locally | Yes when configured | Migration and integration tests passed | Staging verification |
| Redis/BullMQ imports | Yes | Verified locally | Yes when configured | Queue tests passed | Collection queue still missing |
| CSV/XLSX import | Yes | Verified locally | User uploads | Integration and browser E2E passed | Real seller report fixture |
| Analytics | Yes | Partially working | Imported facts | Unit tests pass; DB tests skipped | End-to-end dataset verification |
| Scheduled connectors | Stub | Mock-only/blocked | No | Code inspection | Authorized marketplace connector |
| Marketplace products | Added | Build-level verified | Authorized feeds only | Normalization tests | DB/E2E test with authorized feed |
| MCP server | Added | Build-level verified | No provider configured | Tool/normalization tests | Provider contract and live authorization |

## Baseline evidence

- Production build: passed before and after marketplace changes.
- Initial sandboxed run: 40 passed, 24 skipped, 1 failed because Redis was inaccessible. With the existing Docker Compose PostgreSQL/Redis services, migration 0009 applied and the complete serialized suite passed: **68/68 tests in 17 files**.
- Eight pre-existing migrations were present; migration `0009_marketplace_collection` is additive.
- The dashboard reads PostgreSQL analytics APIs, but its source data is file import. Existing scheduled sync code explicitly fails with `no authorized connector configured`.
- This directory is not a Git worktree. The requested checkpoint was therefore not created.

## Security and release verification

- Migrated to Next.js 16, React 19, Zod 4, patched Nodemailer and BullMQ.
- Replaced vulnerable SheetJS `xlsx` with ExcelJS/csv-parse and pinned its UUID dependency to a patched release.
- `npm audit --omit=dev`: **0 known production vulnerabilities**.
- Production build: passed locally and inside `Dockerfile.production`.
- Runtime image health: liveness and PostgreSQL/Redis readiness returned HTTP 200.
- Unit/integration: **68/68 passed**; browser E2E: **2/2 passed**.
- Backup/restore drill: restored 9 migrations and 41 public tables into an isolated database; temporary artifacts were removed.
