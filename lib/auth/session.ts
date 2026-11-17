// Resolve the authenticated user (and active org) from the request.
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifyAccessToken } from "./jwt";
import { ACCESS_COOKIE, CSRF_COOKIE, ORG_COOKIE } from "./cookies";
import { Unauthorized, Forbidden } from "@/lib/http";

export interface Session {
  userId: bigint;
  email: string;
  isSuperAdmin: boolean;
  activeOrgId: bigint | null;
}

/** Returns the session or null. Accepts httpOnly cookie or Bearer header. */
export async function getSession(req?: Request): Promise<Session | null> {
  const store = await cookies();
  let token = store.get(ACCESS_COOKIE)?.value;
  if (!token && req) {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  }
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const orgCookie = store.get(ORG_COOKIE)?.value;
  return {
    userId: BigInt(claims.sub),
    email: claims.email,
    isSuperAdmin: claims.sa,
    activeOrgId: orgCookie ? BigInt(orgCookie) : null,
  };
}

/** Require a session or throw 401. */
export async function requireSession(req?: Request): Promise<Session> {
  const s = await getSession(req);
  if (!s) throw Unauthorized();
  return s;
}

/**
 * CSRF double-submit check for cookie-authenticated mutations.
 * Skipped for Bearer-token callers (no ambient cookie to exploit).
 */
export function assertCsrf(req: Request): void {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return;
  const header = req.headers.get("x-csrf-token");
  const cookie = req.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
  if (!header || !cookie || header !== cookie) throw Forbidden("Invalid CSRF token");
}
