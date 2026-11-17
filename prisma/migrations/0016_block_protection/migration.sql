-- Block protection: pause a connection (or only its blinkit.com search) after a block page,
-- captcha or HTTP 429, so no automation hits the site again until the pause ends.
ALTER TABLE "PlatformConnection" ADD COLUMN "pausedUntil" TIMESTAMP(3);
ALTER TABLE "PlatformConnection" ADD COLUMN "pauseReason" TEXT;
ALTER TABLE "PlatformConnection" ADD COLUMN "searchPausedUntil" TIMESTAMP(3);
