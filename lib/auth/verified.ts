// Enforce a verified email for sensitive operations (invites, billing, transfers).
import { prisma } from "@/lib/db";
import { Forbidden } from "@/lib/http";
import type { Session } from "./session";
import { logger } from "@/lib/logger";

let warned = false;

export async function requireVerifiedEmail(session: Session): Promise<void> {
  // Without a mail transport nobody can ever verify, so the check would lock every user
  // out. Enforce it only when SMTP is configured (REQUIRE_EMAIL_VERIFICATION=true forces it).
  if (!process.env.SMTP_HOST && process.env.REQUIRE_EMAIL_VERIFICATION !== "true") {
    if (!warned) { warned = true; logger.warn("auth.email_verification_skipped", { reason: "SMTP_HOST not set" }); }
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { emailVerified: true },
  });
  if (!user?.emailVerified) throw Forbidden("Please verify your email to perform this action");
}
