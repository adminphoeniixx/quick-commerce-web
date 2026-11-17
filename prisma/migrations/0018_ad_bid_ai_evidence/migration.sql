ALTER TABLE "AdBidChange"
  ADD COLUMN "evidence" JSONB,
  ADD COLUMN "dataAsOf" DATE,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "promptVersion" TEXT;

ALTER TABLE "PlatformConnection"
  ADD COLUMN "lastAuthCheckAt" TIMESTAMP(3),
  ADD COLUMN "authFailures" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ChannelReport" ADD COLUMN "contentHash" TEXT;
CREATE INDEX "ChannelReport_brandId_platformId_reportType_rangeLabel_contentHash_idx"
  ON "ChannelReport"("brandId", "platformId", "reportType", "rangeLabel", "contentHash");
