// Distributed rate limiter. Uses Redis (fixed window via INCR+EXPIRE) when
// REDIS_URL is set; otherwise falls back to a per-instance in-memory window.
// Provider-independent: callers just `await rateLimit(key, limit, windowSec)`.
import { TooMany } from "@/lib/http";
import type Redis from "ioredis";

let redis: Redis | null = null;
let redisTried = false;

async function getRedis(): Promise<Redis | null> {
  if (redisTried) return redis;
  redisTried = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    redis.on("error", () => {}); // never crash the request path on redis errors
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

// ---- in-memory fallback ----
interface Bucket { count: number; resetAt: number; }
const mem = new Map<string, Bucket>();
function memHit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const b = mem.get(key);
  if (!b || b.resetAt < now) { mem.set(key, { count: 1, resetAt: now + windowSec * 1000 }); return true; }
  b.count += 1;
  return b.count <= limit;
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const r = await getRedis();
  if (r) {
    try {
      const k = `rl:${key}`;
      const count = await r.incr(k);
      if (count === 1) await r.expire(k, windowSec);
      if (count > limit) throw TooMany();
      return;
    } catch (e) {
      if (e instanceof Error && (e as any).status === 429) throw e;
      // fall through to in-memory on redis failure
    }
  }
  if (!memHit(key, limit, windowSec)) throw TooMany();
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of mem) if (b.resetAt < now) mem.delete(k);
  }, 60_000).unref?.();
}
