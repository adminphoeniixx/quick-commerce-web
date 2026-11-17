-- Stock on hand per item x warehouse from the seller-panel inventory export.
CREATE TABLE "ChannelInventory" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT NOT NULL,
    "platformId" INTEGER NOT NULL,
    "skuId" BIGINT,
    "snapshotDate" DATE NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "upc" TEXT,
    "uom" TEXT,
    "warehouseId" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "netScheduled" INTEGER NOT NULL DEFAULT 0,
    "incomingScheduled" INTEGER NOT NULL DEFAULT 0,
    "recalled" INTEGER NOT NULL DEFAULT 0,
    "totalSellable" INTEGER NOT NULL DEFAULT 0,
    "warehouseUnits" INTEGER NOT NULL DEFAULT 0,
    "inBetweenUnits" INTEGER NOT NULL DEFAULT 0,
    "darkstoreUnits" INTEGER NOT NULL DEFAULT 0,
    "totalUnsellable" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "expired" INTEGER NOT NULL DEFAULT 0,
    "nearExpiry" INTEGER NOT NULL DEFAULT 0,
    "sold7d" INTEGER NOT NULL DEFAULT 0,
    "sold15d" INTEGER NOT NULL DEFAULT 0,
    "sold30d" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "reportId" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelInventory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelInventory_brandId_platformId_snapshotDate_itemId_war_key" ON "ChannelInventory"("brandId", "platformId", "snapshotDate", "itemId", "warehouseId");
CREATE INDEX "ChannelInventory_orgId_snapshotDate_idx" ON "ChannelInventory"("orgId", "snapshotDate");
CREATE INDEX "ChannelInventory_brandId_platformId_snapshotDate_idx" ON "ChannelInventory"("brandId", "platformId", "snapshotDate");
ALTER TABLE "ChannelInventory" ADD CONSTRAINT "ChannelInventory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelInventory" ADD CONSTRAINT "ChannelInventory_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelInventory" ADD CONSTRAINT "ChannelInventory_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
