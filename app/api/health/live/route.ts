export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ status: "ok", service: "quick-commerce-pulse", timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } }); }
