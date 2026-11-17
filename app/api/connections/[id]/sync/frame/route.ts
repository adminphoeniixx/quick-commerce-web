// Screenshot of what the sync browser is doing right now (shown in the progress panel).
import { handler } from "@/lib/http";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { syncFrame } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const { connection } = await ownedBrowserConnection(req, ctx.params.id, "integration:read");
  const res = await syncFrame(connection.id);
  if (!res.ok) return new Response(null, { status: 204 });
  return new Response(await res.arrayBuffer(), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
});
