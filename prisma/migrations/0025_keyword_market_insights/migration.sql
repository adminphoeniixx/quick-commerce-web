-- Market learning from blinkit.com search history. New table only.
CREATE TABLE "KeywordMarketInsight" (
  "id" BIGSERIAL PRIMARY KEY,
  "orgId" BIGINT NOT NULL,
  "brandId" BIGINT NOT NULL,
  "keyword" TEXT NOT NULL,
  "sampleDays" INTEGER NOT NULL,
  "meanDailySales" DOUBLE PRECISION NOT NULL,
  "avgOrganicRank" DOUBLE PRECISION,
  "rankSensitivityPct" DOUBLE PRECISION,
  "avgPriceGapPct" DOUBLE PRECISION,
  "priceSensitivityPct" DOUBLE PRECISION,
  "stockoutUpliftPct" DOUBLE PRECISION,
  "adShareTop10" DOUBLE PRECISION,
  "confidence" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "KeywordMarketInsight_brandId_keyword_key" ON "KeywordMarketInsight"("brandId", "keyword");
