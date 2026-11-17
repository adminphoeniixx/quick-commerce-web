// Login progress of the remote window: logged in, blocked, captcha.
import { handler, ok } from "@/lib/http";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { sessionState } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const { connection } = await ownedBrowserConnection(req, ctx.params.id);
  return ok(await sessionState(connection.id));
});
