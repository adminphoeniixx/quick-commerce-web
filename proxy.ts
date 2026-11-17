// Fast dashboard presence guard. Every API still performs server-side RBAC.
import { NextRequest, NextResponse } from "next/server";
const PROTECTED = ["/dashboard", "/admin"];
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED.some(p => pathname === p || pathname.startsWith(`${p}/`));
  if (!needsAuth) return NextResponse.next();
  if (req.cookies.has("qcp_access") || req.cookies.has("qcp_refresh")) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/dashboard/:path*", "/admin/:path*"] };
