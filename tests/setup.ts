// Test environment defaults. Real secrets are never needed for tests.
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-16-chars";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-16-chars";
process.env.ACCESS_TOKEN_TTL ??= "900";
process.env.REFRESH_TOKEN_TTL ??= "2592000";

// Integration tests run only when a database URL is provided.
export const HAS_DB = Boolean(process.env.DATABASE_URL);
