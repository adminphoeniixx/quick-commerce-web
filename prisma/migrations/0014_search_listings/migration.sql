-- CreateTable
CREATE TABLE "SearchListingObservation" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "keyword" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "location" TEXT,
    "rank" INTEGER NOT NULL,
    "organicRank" INTEGER,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "pack" TEXT,
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER,
    "price" DOUBLE PRECISION,
    "mrp" DOUBLE PRECISION,
    "isAd" BOOLEAN NOT NULL DEFAULT false,
    "adCampaignId" TEXT,
    "inventory" INTEGER,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "isOwn" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchListingObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchListingObservation_brandId_snapshotDate_idx" ON "SearchListingObservation"("brandId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "SearchListingObservation_brand_day_kw_city_product_key" ON "SearchListingObservation"("brandId", "platformId", "snapshotDate", "keyword", "city", "productId");

-- AddForeignKey
ALTER TABLE "SearchListingObservation" ADD CONSTRAINT "SearchListingObservation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchListingObservation" ADD CONSTRAINT "SearchListingObservation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchListingObservation" ADD CONSTRAINT "SearchListingObservation_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
