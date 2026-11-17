-- CreateTable
CREATE TABLE "ListingSeoSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "expansionLevel" TEXT,
    "availabilityPct" DOUBLE PRECISION,
    "availabilityTarget" DOUBLE PRECISION,
    "unitsPerStoreDay" DOUBLE PRECISION,
    "unitsTarget" DOUBLE PRECISION,
    "salesPerStoreDay" DOUBLE PRECISION,
    "salesTarget" DOUBLE PRECISION,
    "complaintPct" DOUBLE PRECISION,
    "storesLive" INTEGER,
    "storesNew" INTEGER,
    "storesClosed" INTEGER,
    "citiesLive" INTEGER,
    "citiesNew" INTEGER,
    "citiesClosed" INTEGER,
    "assessmentEnd" TIMESTAMP(3),
    "periodLabel" TEXT,
    "units" INTEGER,
    "sales" DOUBLE PRECISION,
    "salesSharePct" DOUBLE PRECISION,
    "complaints" INTEGER,
    "titleLength" INTEGER NOT NULL DEFAULT 0,
    "descriptionLength" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "attrsFilled" INTEGER NOT NULL DEFAULT 0,
    "attrsTotal" INTEGER NOT NULL DEFAULT 0,
    "engagementScore" DOUBLE PRECISION,
    "missingAttributes" JSONB NOT NULL,
    "cities" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingSeoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingSeoSnapshot_orgId_idx" ON "ListingSeoSnapshot"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingSeoSnapshot_brand_platform_date_product_key" ON "ListingSeoSnapshot"("brandId", "platformId", "snapshotDate", "productId");

-- AddForeignKey
ALTER TABLE "ListingSeoSnapshot" ADD CONSTRAINT "ListingSeoSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingSeoSnapshot" ADD CONSTRAINT "ListingSeoSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingSeoSnapshot" ADD CONSTRAINT "ListingSeoSnapshot_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
