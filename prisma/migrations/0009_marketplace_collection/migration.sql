CREATE TYPE "MarketplaceCode" AS ENUM ('BLINKIT', 'ZEPTO', 'INSTAMART', 'AUTHORIZED_FEED');
CREATE TYPE "ObservationAvailability" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN');
CREATE TYPE "ScrapingRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'EMPTY', 'PARTIAL', 'FAILED', 'CANCELED', 'DEAD_LETTERED');

CREATE TABLE "MarketplaceProduct" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "platform" "MarketplaceCode" NOT NULL,
  "platformProductId" TEXT NOT NULL, "productUrl" TEXT NOT NULL, "title" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL, "brand" TEXT, "category" TEXT, "subcategory" TEXT,
  "imageUrl" TEXT, "packSize" TEXT, "unit" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "lastObservedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "MarketplaceProduct_organizationId_platform_platformProductId_key" ON "MarketplaceProduct"("organizationId","platform","platformProductId");
CREATE INDEX "MarketplaceProduct_organizationId_lastObservedAt_idx" ON "MarketplaceProduct"("organizationId","lastObservedAt");
CREATE INDEX "MarketplaceProduct_organizationId_platform_brand_category_idx" ON "MarketplaceProduct"("organizationId","platform","brand","category");

CREATE TABLE "ScrapingRun" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "platform" "MarketplaceCode" NOT NULL,
  "status" "ScrapingRunStatus" NOT NULL DEFAULT 'QUEUED', "jobId" TEXT, "collectionType" TEXT NOT NULL,
  "keyword" TEXT, "city" TEXT NOT NULL, "locationKey" TEXT NOT NULL, "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "discoveredCount" INTEGER NOT NULL DEFAULT 0, "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0, "failedCount" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT,
  "errorSummary" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScrapingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ScrapingRun_jobId_key" ON "ScrapingRun"("jobId");
CREATE INDEX "ScrapingRun_organizationId_createdAt_idx" ON "ScrapingRun"("organizationId","createdAt");
CREATE INDEX "ScrapingRun_status_createdAt_idx" ON "ScrapingRun"("status","createdAt");

CREATE TABLE "ProductPriceObservation" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "productId" BIGINT NOT NULL,
  "platform" "MarketplaceCode" NOT NULL, "city" TEXT NOT NULL, "locationKey" TEXT NOT NULL,
  "mrp" DECIMAL(10,2), "sellingPrice" DECIMAL(10,2) NOT NULL, "currency" TEXT NOT NULL DEFAULT 'INR',
  "discountPct" DECIMAL(5,2), "observedAt" TIMESTAMP(3) NOT NULL, "sourceUrl" TEXT NOT NULL, "collectionRunId" BIGINT NOT NULL,
  CONSTRAINT "ProductPriceObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductPriceObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketplaceProduct"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductPriceObservation_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "ScrapingRun"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ProductPriceObservation_productId_locationKey_observedAt_collectionRunId_key" ON "ProductPriceObservation"("productId","locationKey","observedAt","collectionRunId");
CREATE INDEX "ProductPriceObservation_organizationId_platform_city_observedAt_idx" ON "ProductPriceObservation"("organizationId","platform","city","observedAt");

CREATE TABLE "ProductAvailabilityObservation" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "productId" BIGINT NOT NULL,
  "platform" "MarketplaceCode" NOT NULL, "city" TEXT NOT NULL, "locationKey" TEXT NOT NULL,
  "availabilityStatus" "ObservationAvailability" NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceUrl" TEXT NOT NULL, "collectionRunId" BIGINT NOT NULL,
  CONSTRAINT "ProductAvailabilityObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductAvailabilityObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketplaceProduct"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductAvailabilityObservation_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "ScrapingRun"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ProductAvailabilityObservation_productId_locationKey_observedAt_collectionRunId_key" ON "ProductAvailabilityObservation"("productId","locationKey","observedAt","collectionRunId");
CREATE INDEX "ProductAvailabilityObservation_organizationId_platform_city_observedAt_idx" ON "ProductAvailabilityObservation"("organizationId","platform","city","observedAt");

CREATE TABLE "ProductRankingObservation" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "productId" BIGINT NOT NULL,
  "keyword" TEXT NOT NULL, "platform" "MarketplaceCode" NOT NULL, "locationKey" TEXT NOT NULL,
  "rank" INTEGER NOT NULL, "placementType" TEXT NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL, "collectionRunId" BIGINT NOT NULL,
  CONSTRAINT "ProductRankingObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductRankingObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketplaceProduct"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductRankingObservation_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "ScrapingRun"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ProductRankingObservation_productId_keyword_locationKey_observedAt_collectionRunId_key" ON "ProductRankingObservation"("productId","keyword","locationKey","observedAt","collectionRunId");
CREATE INDEX "ProductRankingObservation_organizationId_platform_keyword_observedAt_idx" ON "ProductRankingObservation"("organizationId","platform","keyword","observedAt");

CREATE TABLE "ScrapingSchedule" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "platform" "MarketplaceCode" NOT NULL,
  "collectionType" TEXT NOT NULL, "keyword" TEXT, "city" TEXT NOT NULL, "locationKey" TEXT NOT NULL,
  "schedule" TEXT NOT NULL, "timezone" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" TIMESTAMP(3), "nextRunAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScrapingSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE INDEX "ScrapingSchedule_organizationId_enabled_idx" ON "ScrapingSchedule"("organizationId","enabled");

CREATE TABLE "ProductMatch" (
  "id" BIGSERIAL PRIMARY KEY, "organizationId" BIGINT NOT NULL, "sourceProductId" BIGINT NOT NULL,
  "targetProductId" BIGINT NOT NULL, "confidence" DECIMAL(5,4) NOT NULL, "matchStatus" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "reviewedBy" BIGINT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductMatch_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "MarketplaceProduct"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductMatch_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "MarketplaceProduct"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ProductMatch_organizationId_sourceProductId_targetProductId_key" ON "ProductMatch"("organizationId","sourceProductId","targetProductId");
CREATE INDEX "ProductMatch_organizationId_matchStatus_idx" ON "ProductMatch"("organizationId","matchStatus");
