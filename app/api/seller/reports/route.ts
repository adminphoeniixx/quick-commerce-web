// Every report fetched from the seller panel (files are downloaded separately).
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { sellerScope } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await sellerScope(req, "report:read");
  const reports = await prisma.channelReport.findMany({
    where: { brandId: scope.brandId, platformId: scope.platformId },
    orderBy: { createdAt: "desc" }, take: 300,
    select: { id: true, reportType: true, rangeLabel: true, periodFrom: true, periodTo: true, status: true, rowsTotal: true, rowsImported: true, fileName: true, error: true, trigger: true, createdAt: true },
  });
  return ok({ reports });
});
