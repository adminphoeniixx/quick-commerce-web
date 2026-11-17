INSERT INTO "SyncSchedule" ("orgId", "brandId", "platformId", "dataType", "cron", "enabled", "lastStatus", "createdAt")
SELECT c."orgId", c."brandId", c."platformId", 'auth_health', '17 */8 * * *', true, 'registered', NOW()
FROM "PlatformConnection" c
JOIN "Platform" p ON p.id = c."platformId"
WHERE p.slug IN ('blinkit', 'blinkit-ads')
  AND NOT EXISTS (
    SELECT 1 FROM "SyncSchedule" s
    WHERE s."orgId" = c."orgId" AND s."brandId" = c."brandId"
      AND s."platformId" = c."platformId" AND s."dataType" = 'auth_health'
  );
