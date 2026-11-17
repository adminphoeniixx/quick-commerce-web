import { prisma } from "@/lib/db";
import { queuesEnabled, redisConnection } from "@/lib/queue/connection";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
async function bounded<T>(promise: Promise<T>, ms=2000): Promise<T> { return Promise.race([promise, new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("timeout")),ms))]); }
export async function GET() {
  const checks: Record<string,string> = {};
  try { await bounded(prisma.$queryRaw`SELECT 1`); checks.database = "ok"; } catch { checks.database = "unavailable"; }
  if (queuesEnabled()) { try { if (await bounded(redisConnection().ping()) !== "PONG") throw new Error("bad response"); checks.redis = "ok"; } catch { checks.redis = "unavailable"; } } else checks.redis = "disabled";
  const ready = checks.database === "ok" && checks.redis !== "unavailable";
  return Response.json({ status: ready ? "ready" : "not_ready", checks, timestamp: new Date().toISOString() }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
