// Issue a full login session: access JWT + rotating refresh + CSRF cookie.
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { signAccessToken } from "./jwt";
import { issueRefreshToken } from "./tokens";
import { setAuthCookies, setActiveOrg, newCsrfToken } from "./cookies";

export async function issueSession(
  res: NextResponse,
  user: Pick<User, "id" | "email" | "isSuperAdmin">,
  activeOrgId?: bigint | null,
): Promise<void> {
  const access = await signAccessToken({
    sub: user.id.toString(),
    email: user.email,
    sa: user.isSuperAdmin,
  });
  const refresh = await issueRefreshToken(user.id);
  const csrf = newCsrfToken();
  setAuthCookies(res, { access, refresh, csrf });
  if (activeOrgId) setActiveOrg(res, activeOrgId.toString());
}
