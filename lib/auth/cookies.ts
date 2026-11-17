// Cookie helpers. Access + refresh are httpOnly; a non-httpOnly CSRF token
// supports double-submit protection for cookie-authenticated mutations.
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const ACCESS_COOKIE = "qcp_access";
export const REFRESH_COOKIE = "qcp_refresh";
export const CSRF_COOKIE = "qcp_csrf";
export const ORG_COOKIE = "qcp_org";

// Production defaults secure; local browser tests may explicitly opt out.
const isProd = process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production";
const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL ?? 900);
const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL ?? 2592000);

export function newCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export function setAuthCookies(
  res: NextResponse,
  tokens: { access: string; refresh: string; csrf: string },
): void {
  res.cookies.set(ACCESS_COOKIE, tokens.access, {
    httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: ACCESS_TTL,
  });
  res.cookies.set(REFRESH_COOKIE, tokens.refresh, {
    httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: REFRESH_TTL,
  });
  res.cookies.set(CSRF_COOKIE, tokens.csrf, {
    httpOnly: false, secure: isProd, sameSite: "lax", path: "/", maxAge: REFRESH_TTL,
  });
}

export function setActiveOrg(res: NextResponse, orgId: string): void {
  res.cookies.set(ORG_COOKIE, orgId, {
    httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: REFRESH_TTL,
  });
}

export function clearAuthCookies(res: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE, ORG_COOKIE]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}
