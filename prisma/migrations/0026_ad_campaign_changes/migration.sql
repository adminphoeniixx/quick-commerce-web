-- Keyword Growth Agent: approved changes to existing campaigns (budget update / restart / stop).
CREATE TABLE "AdCampaignChange" (
  "id" BIGSERIAL PRIMARY KEY,
  "orgId" BIGINT NOT NULL,
  "brandId" BIGINT NOT NULL,
  "platformId" INTEGER NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignName" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "expectedStatus" TEXT NOT NULL,
  "expectedBudget" DECIMAL(14,2),
  "toBudget" DECIMAL(14,2),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "growthPlanId" BIGINT,
  "createdBy" TEXT NOT NULL,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AdCampaignChange_brandId_platformId_status_idx" ON "AdCampaignChange"("brandId", "platformId", "status");
CREATE INDEX "AdCampaignChange_growthPlanId_idx" ON "AdCampaignChange"("growthPlanId");
