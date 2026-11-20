-- Learning from scraped history: outcomes may come from detected historical events, not only plans.
ALTER TABLE "GrowthActionOutcome"
  ALTER COLUMN "planId" DROP NOT NULL,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PLAN',
  ADD COLUMN "eventKey" TEXT;
CREATE UNIQUE INDEX "GrowthActionOutcome_brandId_eventKey_key" ON "GrowthActionOutcome"("brandId", "eventKey");
