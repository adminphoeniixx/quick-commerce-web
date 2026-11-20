-- Sales-growth production lifecycle: async research jobs, per-action execution records,
-- autopilot re-planning and plan linkage on the bid / campaign approval queues.

ALTER TABLE "SalesGrowthGoal"
  ADD COLUMN "autopilot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "replanEveryDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "notifyEmail" TEXT;
CREATE INDEX "SalesGrowthGoal_active_autopilot_idx" ON "SalesGrowthGoal"("active", "autopilot");

ALTER TABLE "SalesGrowthPlan"
  ALTER COLUMN "status" SET DEFAULT 'QUEUED',
  ALTER COLUMN "baseline" DROP NOT NULL,
  ALTER COLUMN "forecast" DROP NOT NULL,
  ALTER COLUMN "actions" DROP NOT NULL,
  ALTER COLUMN "agentReviews" DROP NOT NULL,
  ALTER COLUMN "dataAsOf" DROP NOT NULL,
  ALTER COLUMN "payloadHash" DROP NOT NULL,
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "error" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE INDEX "SalesGrowthPlan_status_materializedAt_idx" ON "SalesGrowthPlan"("status", "materializedAt");

CREATE TABLE "SalesGrowthAction" (
  "id" BIGSERIAL PRIMARY KEY,
  "planId" BIGINT NOT NULL,
  "orgId" BIGINT NOT NULL,
  "brandId" BIGINT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "campaignId" TEXT,
  "keyword" TEXT,
  "matchType" TEXT,
  "payload" JSONB NOT NULL,
  "forecastSalesDelta" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "bidChangeId" BIGINT,
  "campaignProposalId" BIGINT,
  "remoteCampaignId" TEXT,
  "error" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesGrowthAction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesGrowthPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesGrowthAction_planId_actionKey_key" ON "SalesGrowthAction"("planId", "actionKey");
CREATE INDEX "SalesGrowthAction_brandId_status_idx" ON "SalesGrowthAction"("brandId", "status");

-- Backfill execution records for plans researched before this migration.
INSERT INTO "SalesGrowthAction" ("planId", "orgId", "brandId", "actionKey", "type", "priority", "title", "campaignId", "keyword", "matchType", "payload", "forecastSalesDelta", "status", "updatedAt")
SELECT p."id", p."orgId", p."brandId", a->>'id', a->>'type', COALESCE((a->>'priority')::int, 9), COALESCE(a->>'title', ''), a->>'campaignId',
       a->'payload'->>'keyword', a->'payload'->>'matchType', COALESCE(a->'payload', '{}'::jsonb), COALESCE(a->'forecastSalesDelta', '{"low":0,"high":0}'::jsonb),
       CASE p."status" WHEN 'DRAFT' THEN 'PROPOSED' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'MATERIALIZED' THEN 'DRAFTED' ELSE 'APPROVED' END,
       CURRENT_TIMESTAMP
FROM "SalesGrowthPlan" p, jsonb_array_elements(COALESCE(p."actions", '[]'::jsonb)) a
WHERE a->>'id' IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "AdBidChange" ADD COLUMN "growthPlanId" BIGINT;
CREATE INDEX "AdBidChange_growthPlanId_idx" ON "AdBidChange"("growthPlanId");
ALTER TABLE "AdCampaignProposal" ADD COLUMN "growthPlanId" BIGINT;
CREATE INDEX "AdCampaignProposal_growthPlanId_idx" ON "AdCampaignProposal"("growthPlanId");
