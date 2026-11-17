CREATE TABLE "AdCampaignProposal" (
  "id" BIGSERIAL PRIMARY KEY,
  "orgId" BIGINT NOT NULL,
  "brandId" BIGINT NOT NULL,
  "platformId" INTEGER NOT NULL,
  "templateCampaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "budget" DECIMAL(14,2) NOT NULL,
  "startAt" DATE NOT NULL,
  "endAt" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  "evidence" JSONB NOT NULL,
  "forecast" JSONB NOT NULL,
  "agentReviews" JSONB NOT NULL,
  "dataAsOf" DATE NOT NULL,
  "model" TEXT,
  "promptVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "remoteCampaignId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdCampaignProposal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "AdCampaignProposal_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE,
  CONSTRAINT "AdCampaignProposal_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id")
);
CREATE UNIQUE INDEX "AdCampaignProposal_orgId_idempotencyKey_key" ON "AdCampaignProposal"("orgId", "idempotencyKey");
CREATE INDEX "AdCampaignProposal_brandId_platformId_status_idx" ON "AdCampaignProposal"("brandId", "platformId", "status");
CREATE INDEX "AdCampaignProposal_templateCampaignId_idx" ON "AdCampaignProposal"("templateCampaignId");
