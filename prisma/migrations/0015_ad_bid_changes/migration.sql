-- CreateTable
CREATE TABLE "AdBidChange" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "fromCpm" DECIMAL(10,2),
    "toCpm" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "beforeCpm" DECIMAL(10,2),
    "afterCpm" DECIMAL(10,2),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdBidChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdBidChange_brandId_platformId_status_idx" ON "AdBidChange"("brandId", "platformId", "status");

-- CreateIndex
CREATE INDEX "AdBidChange_brandId_platformId_campaignId_idx" ON "AdBidChange"("brandId", "platformId", "campaignId");

-- AddForeignKey
ALTER TABLE "AdBidChange" ADD CONSTRAINT "AdBidChange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdBidChange" ADD CONSTRAINT "AdBidChange_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdBidChange" ADD CONSTRAINT "AdBidChange_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
