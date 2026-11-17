// Blinkit Ads login: opens the sign-in link the user received by email in the live
// login window. The link is a one-time credential; it is forwarded, never stored or logged.
import { z } from "zod";
import { handler, ok, parseBody, BadRequest } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { openSessionLink } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().url().max(4096) });

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req);
  const { connection } = await ownedBrowserConnection(req, ctx.params.id);
  if (connection.platform.slug !== "blinkit-ads") throw BadRequest("Sign-in links are only used by Blinkit Ads");
  await rateLimit(`browser-link:${connection.id}`, 10, 600);
  const { url } = await parseBody(req, schema);
  return ok(await openSessionLink(connection.id, url));
});
