-- CreateTable
CREATE TABLE "AdAccountSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "advertiserName" TEXT,
    "status" TEXT,
    "walletBalance" DECIMAL(14,2),
    "tentativeSpend" DECIMAL(14,2),
    "creditBalance" DECIMAL(14,2),
    "festive" JSONB,
    "collections" JSONB,
    "details" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignType" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "budget" DECIMAL(14,2),
    "pacing" TEXT,
    "regionType" TEXT,
    "cities" TEXT[],
    "productIds" TEXT[],
    "keywords" JSONB,
    "lifetimeSpend" DECIMAL(14,2),
    "lifetimeImpressions" BIGINT,
    "lifetimeSales" DECIMAL(14,2),
    "lifetimeAtc" INTEGER,
    "details" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaignDaily" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DECIMAL(8,4),
    "directAtc" INTEGER NOT NULL DEFAULT 0,
    "indirectAtc" INTEGER NOT NULL DEFAULT 0,
    "totalAtc" INTEGER NOT NULL DEFAULT 0,
    "directSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "indirectSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directQty" INTEGER NOT NULL DEFAULT 0,
    "indirectQty" INTEGER NOT NULL DEFAULT 0,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaignDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdKeywordDaily" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "matchType" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directAtc" INTEGER NOT NULL DEFAULT 0,
    "indirectAtc" INTEGER NOT NULL DEFAULT 0,
    "directSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "indirectSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directQty" INTEGER NOT NULL DEFAULT 0,
    "indirectQty" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdKeywordDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdAccountSnapshot_orgId_idx" ON "AdAccountSnapshot"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccountSnapshot_brandId_platformId_snapshotDate_key" ON "AdAccountSnapshot"("brandId", "platformId", "snapshotDate");

-- CreateIndex
CREATE INDEX "AdCampaign_orgId_idx" ON "AdCampaign"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_brandId_platformId_campaignId_key" ON "AdCampaign"("brandId", "platformId", "campaignId");

-- CreateIndex
CREATE INDEX "AdCampaignDaily_orgId_date_idx" ON "AdCampaignDaily"("orgId", "date");

-- CreateIndex
CREATE INDEX "AdCampaignDaily_brandId_platformId_date_idx" ON "AdCampaignDaily"("brandId", "platformId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignDaily_brandId_platformId_campaignId_date_key" ON "AdCampaignDaily"("brandId", "platformId", "campaignId", "date");

-- CreateIndex
CREATE INDEX "AdKeywordDaily_brandId_platformId_date_idx" ON "AdKeywordDaily"("brandId", "platformId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdKeywordDaily_brandId_platformId_campaignId_date_dimension_key" ON "AdKeywordDaily"("brandId", "platformId", "campaignId", "date", "dimension", "dimKey");

-- AddForeignKey
ALTER TABLE "AdAccountSnapshot" ADD CONSTRAINT "AdAccountSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccountSnapshot" ADD CONSTRAINT "AdAccountSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccountSnapshot" ADD CONSTRAINT "AdAccountSnapshot_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignDaily" ADD CONSTRAINT "AdCampaignDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignDaily" ADD CONSTRAINT "AdCampaignDaily_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignDaily" ADD CONSTRAINT "AdCampaignDaily_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdKeywordDaily" ADD CONSTRAINT "AdKeywordDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdKeywordDaily" ADD CONSTRAINT "AdKeywordDaily_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdKeywordDaily" ADD CONSTRAINT "AdKeywordDaily_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Blinkit Ads is its own connector (separate login from the seller panel).
INSERT INTO "Platform" ("name", "slug", "brandColor") VALUES ('Blinkit Ads', 'blinkit-ads', '#f8cb46')
ON CONFLICT ("slug") DO NOTHING;
