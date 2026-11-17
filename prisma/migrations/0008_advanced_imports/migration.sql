ALTER TYPE "JobStatus" ADD VALUE 'STAGED' BEFORE 'QUEUED';
ALTER TYPE "JobStatus" ADD VALUE 'VALIDATED' BEFORE 'QUEUED';

CREATE TABLE "ImportMappingTemplate" (
  "id" BIGSERIAL NOT NULL,
  "orgId" BIGINT NOT NULL,
  "name" TEXT NOT NULL,
  "platformSlug" TEXT NOT NULL,
  "dataType" TEXT NOT NULL,
  "mappingJson" JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" BIGINT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportMappingTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportMappingTemplate_orgId_name_key" ON "ImportMappingTemplate"("orgId", "name");
CREATE INDEX "ImportMappingTemplate_orgId_platformSlug_dataType_idx" ON "ImportMappingTemplate"("orgId", "platformSlug", "dataType");
ALTER TABLE "ImportMappingTemplate" ADD CONSTRAINT "ImportMappingTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportMappingTemplate" ADD CONSTRAINT "ImportMappingTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImportJob"
  ADD COLUMN "selectedSheet" TEXT,
  ADD COLUMN "mappingJson" JSONB,
  ADD COLUMN "validationSummary" JSONB,
  ADD COLUMN "mappingTemplateId" BIGINT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "retentionUntil" TIMESTAMP(3);
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_mappingTemplateId_fkey" FOREIGN KEY ("mappingTemplateId") REFERENCES "ImportMappingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportError"
  ADD COLUMN "sourceField" TEXT,
  ADD COLUMN "canonicalField" TEXT,
  ADD COLUMN "originalValue" TEXT,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "suggestion" TEXT;
