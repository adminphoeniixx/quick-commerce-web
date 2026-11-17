// Shared Redis connection for BullMQ. maxRetriesPerRequest must be null for workers.
import IORedis, { type Redis } from "ioredis";
import { logger } from "@/lib/logger";

let conn: Redis | null = null;

export function redisConnection(): Redis {
  if (conn) return conn;
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  conn = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 5000),
    retryStrategy: (attempt) => Math.min(250 * 2 ** Math.min(attempt, 5), 5000),
  });
  conn.on("error", (e) => logger.error("redis.connection_error", { error: e }));
  conn.on("reconnecting", (delay: number) => logger.warn("redis.reconnecting", { delay }));
  conn.on("ready", () => logger.info("redis.ready"));
  return conn;
}

export async function closeRedisConnection(): Promise<void> {
  if (!conn) return;
  const current = conn; conn = null;
  await current.quit().catch(() => current.disconnect());
}

export function queuesEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}
