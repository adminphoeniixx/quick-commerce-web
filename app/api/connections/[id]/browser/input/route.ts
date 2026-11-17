// Forwards the user's clicks / typing to the remote login window.
import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { sessionInput } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number().min(0).max(1280), y: z.number().min(0).max(800) }),
  z.object({ type: z.literal("type"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("key"), key: z.string().max(20) }),
  z.object({ type: z.literal("scroll"), dy: z.number().min(-3000).max(3000) }),
]);

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req);
  const { connection } = await ownedBrowserConnection(req, ctx.params.id);
  await rateLimit(`browser-input:${connection.id}`, 600, 60);
  return ok(await sessionInput(connection.id, await parseBody(req, schema)));
});
