-- Sales-growth learning: per-action outcomes and forecast calibration. New tables only.
CREATE TABLE "GrowthActionOutcome" (
  "id" BIGSERIAL PRIMARY KEY,
  "orgId" BIGINT NOT NULL,
  "brandId" BIGINT NOT NULL,
  "planId" BIGINT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "campaignId" TEXT,
  "keyword" TEXT,
  "matchType" TEXT,
  "changePct" DOUBLE PRECISION,
  "forecastLow" DOUBLE PRECISION NOT NULL,
  "forecastHigh" DOUBLE PRECISION NOT NULL,
  "beforeSales" DOUBLE PRECISION NOT NULL,
  "beforeSpend" DOUBLE PRECISION NOT NULL,
  "afterSales" DOUBLE PRECISION NOT NULL,
  "afterSpend" DOUBLE PRECISION NOT NULL,
  "controlGrowthPct" DOUBLE PRECISION,
  "salesDelta" DOUBLE PRECISION NOT NULL,
  "forecastRatio" DOUBLE PRECISION,
  "measuredFrom" DATE NOT NULL,
  "measuredTo" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GrowthActionOutcome_planId_actionKey_key" ON "GrowthActionOutcome"("planId", "actionKey");
CREATE INDEX "GrowthActionOutcome_brandId_type_direction_createdAt_idx" ON "GrowthActionOutcome"("brandId", "type", "direction", "createdAt");
CREATE INDEX "GrowthActionOutcome_brandId_campaignId_keyword_idx" ON "GrowthActionOutcome"("brandId", "campaignId", "keyword");

CREATE TABLE "GrowthCalibration" (
  "id" BIGSERIAL PRIMARY KEY,
  "orgId" BIGINT NOT NULL,
  "brandId" BIGINT NOT NULL,
  "type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "rawRatio" DOUBLE PRECISION NOT NULL,
  "factor" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "GrowthCalibration_brandId_type_direction_key" ON "GrowthCalibration"("brandId", "type", "direction");
