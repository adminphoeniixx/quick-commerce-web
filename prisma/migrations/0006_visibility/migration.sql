-- CreateTable
CREATE TABLE "VisibilityObservation" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "keywordId" BIGINT NOT NULL,
    "cityId" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "observedBrand" TEXT NOT NULL,
    "skuCode" TEXT,
    "rank" INTEGER NOT NULL,
    "page" INTEGER,
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "isOwn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VisibilityObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisibilityObservation_brandId_snapshotDate_idx" ON "VisibilityObservation"("brandId", "snapshotDate");

-- CreateIndex
CREATE INDEX "VisibilityObservation_keywordId_idx" ON "VisibilityObservation"("keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "VisibilityObservation_orgId_platformId_keywordId_cityId_sna_key" ON "VisibilityObservation"("orgId", "platformId", "keywordId", "cityId", "snapshotDate", "observedBrand");

-- AddForeignKey
ALTER TABLE "VisibilityObservation" ADD CONSTRAINT "VisibilityObservation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityObservation" ADD CONSTRAINT "VisibilityObservation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityObservation" ADD CONSTRAINT "VisibilityObservation_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityObservation" ADD CONSTRAINT "VisibilityObservation_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityObservation" ADD CONSTRAINT "VisibilityObservation_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

