// Latest screenshot of the remote login window (polled by the Connect dialog).
import { handler } from "@/lib/http";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { sessionFrame } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const { connection } = await ownedBrowserConnection(req, ctx.params.id);
  const res = await sessionFrame(connection.id);
  // 204: the window is already closed (a last poll racing Stop), nothing to show.
  if (!res.ok) return new Response(null, { status: res.status === 404 ? 204 : 502 });
  return new Response(await res.arrayBuffer(), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
});
