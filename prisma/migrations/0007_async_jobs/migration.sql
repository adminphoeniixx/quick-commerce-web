-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'RETRY_SCHEDULED';
ALTER TYPE "JobStatus" ADD VALUE 'DEAD_LETTERED';

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duplicates" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "platformSlug" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queueJobId" TEXT;

-- CreateTable
CREATE TABLE "SyncSchedule" (
    "id" BIGSERIAL NOT NULL,
    "orgId" BIGINT NOT NULL,
    "brandId" BIGINT,
    "platformId" INTEGER,
    "dataType" TEXT NOT NULL DEFAULT 'sales',
    "cron" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncSchedule_orgId_idx" ON "SyncSchedule"("orgId");

-- CreateIndex
CREATE INDEX "SyncSchedule_enabled_idx" ON "SyncSchedule"("enabled");

-- AddForeignKey
ALTER TABLE "SyncSchedule" ADD CONSTRAINT "SyncSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

