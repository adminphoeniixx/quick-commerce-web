CREATE TABLE "SalesGrowthGoal" (
  "id" BIGSERIAL PRIMARY KEY, "orgId" BIGINT NOT NULL, "brandId" BIGINT NOT NULL,
  "targetSalesGrowthPct" DECIMAL(6,2) NOT NULL, "maxDailyAdSpend" DECIMAL(14,2) NOT NULL,
  "minimumRoas" DECIMAL(8,3) NOT NULL, "horizonDays" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SalesGrowthGoal_orgId_brandId_active_idx" ON "SalesGrowthGoal"("orgId", "brandId", "active");

CREATE TABLE "SalesGrowthPlan" (
  "id" BIGSERIAL PRIMARY KEY, "orgId" BIGINT NOT NULL, "brandId" BIGINT NOT NULL, "goalId" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "baseline" JSONB NOT NULL, "forecast" JSONB NOT NULL,
  "actions" JSONB NOT NULL, "agentReviews" JSONB NOT NULL, "dataAsOf" DATE NOT NULL,
  "model" TEXT, "promptVersion" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "measuredAt" TIMESTAMP(3), "outcome" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "SalesGrowthPlan_orgId_payloadHash_key" ON "SalesGrowthPlan"("orgId", "payloadHash");
CREATE INDEX "SalesGrowthPlan_brandId_status_createdAt_idx" ON "SalesGrowthPlan"("brandId", "status", "createdAt");
CREATE INDEX "SalesGrowthPlan_goalId_idx" ON "SalesGrowthPlan"("goalId");
