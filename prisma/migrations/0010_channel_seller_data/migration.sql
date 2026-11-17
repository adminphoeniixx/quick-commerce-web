-- Seller-panel data from the browser connector: synced reports, catalog, order lines.

CREATE TABLE "ChannelReport" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "reportType" TEXT NOT NULL,
    "rangeLabel" TEXT,
    "periodFrom" DATE,
    "periodTo" DATE,
    "status" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "fileData" BYTEA,
    "error" TEXT,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelProduct" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "skuId" BIGINT,
    "itemId" TEXT NOT NULL,
    "productId" TEXT,
    "upc" TEXT,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "uom" TEXT,
    "mrp" DECIMAL(10,2),
    "sellingPrice" DECIMAL(10,2),
    "status" TEXT,
    "businessCategory" TEXT,
    "manufacturer" TEXT,
    "hsn" TEXT,
    "gstPct" DECIMAL(6,2),
    "commissionPct" DECIMAL(6,2),
    "commissionValue" DECIMAL(10,2),
    "fulfillmentFee" DECIMAL(10,2),
    "details" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelOrder" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "skuId" BIGINT,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "productName" TEXT NOT NULL,
    "variant" TEXT,
    "categoryPath" TEXT,
    "businessCategory" TEXT,
    "expansionLevel" TEXT,
    "supplyCity" TEXT,
    "supplyState" TEXT,
    "customerCity" TEXT,
    "customerState" TEXT,
    "status" TEXT NOT NULL,
    "hsn" TEXT,
    "quantity" INTEGER NOT NULL,
    "mrp" DECIMAL(10,2),
    "sellingPrice" DECIMAL(10,2),
    "igstPct" DECIMAL(6,3),
    "cgstPct" DECIMAL(6,3),
    "sgstPct" DECIMAL(6,3),
    "cessPct" DECIMAL(6,3),
    "igstValue" DECIMAL(10,2),
    "cgstValue" DECIMAL(10,2),
    "sgstValue" DECIMAL(10,2),
    "cessValue" DECIMAL(10,2),
    "totalTax" DECIMAL(10,2),
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "reportId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChannelReport_orgId_createdAt_idx" ON "ChannelReport"("orgId", "createdAt");

CREATE INDEX "ChannelReport_brandId_platformId_createdAt_idx" ON "ChannelReport"("brandId", "platformId", "createdAt");

CREATE INDEX "ChannelProduct_orgId_idx" ON "ChannelProduct"("orgId");

CREATE UNIQUE INDEX "ChannelProduct_brandId_platformId_itemId_key" ON "ChannelProduct"("brandId", "platformId", "itemId");

CREATE INDEX "ChannelOrder_orgId_orderDate_idx" ON "ChannelOrder"("orgId", "orderDate");

CREATE INDEX "ChannelOrder_brandId_platformId_orderDate_idx" ON "ChannelOrder"("brandId", "platformId", "orderDate");

CREATE UNIQUE INDEX "ChannelOrder_brandId_platformId_orderId_itemId_key" ON "ChannelOrder"("brandId", "platformId", "orderId", "itemId");

ALTER TABLE "ChannelReport" ADD CONSTRAINT "ChannelReport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelReport" ADD CONSTRAINT "ChannelReport_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelReport" ADD CONSTRAINT "ChannelReport_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChannelOrder" ADD CONSTRAINT "ChannelOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelOrder" ADD CONSTRAINT "ChannelOrder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelOrder" ADD CONSTRAINT "ChannelOrder_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
