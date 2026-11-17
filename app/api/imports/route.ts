import { prisma } from "@/lib/db";
import { handler, ok, BadRequest } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { requireVerifiedEmail } from "@/lib/auth/verified";
import { parseTabular } from "@/lib/ingest/parse";
import { stageFile } from "@/lib/ingest/staging";
import { processImportJob } from "@/lib/queue/processors";
import { queuesEnabled } from "@/lib/queue/connection";
import { enqueueImport } from "@/lib/queue/producers";
import { writeAudit } from "@/lib/audit";
import type { PlatformSlug } from "@/lib/types";
import type { DataType } from "@/lib/ingest/contracts";
import type { ImportSource } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const VALID_PLATFORMS: PlatformSlug[] = ["blinkit", "zepto", "instamart", "bigbasket"];
const VALID_TYPES: DataType[] = ["sales", "availability", "pricing", "visibility", "products"];

// Upload a CSV/Excel export. The file is staged and processing is enqueued to a
// BullMQ worker; the response returns the import job id to poll. When Redis is
// not configured the job is processed inline as a fallback (same code path).
export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  await requireVerifiedEmail(session);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "integration:create");

  const form = await req.formData().catch(() => null);
  if (!form) throw BadRequest("Expected multipart/form-data");

  const file = form.get("file");
  const platform = String(form.get("platform") ?? "") as PlatformSlug;
  const dataType = String(form.get("dataType") ?? "sales") as DataType;
  const brandIdRaw = String(form.get("brandId") ?? "");

  if (!(file instanceof File)) throw BadRequest("Missing file");
  if (file.size > MAX_BYTES) throw BadRequest("File exceeds 10 MB limit");
  if (!VALID_PLATFORMS.includes(platform)) throw BadRequest("Invalid platform");
  if (!VALID_TYPES.includes(dataType)) throw BadRequest("Invalid data type");
  let brandId: bigint;
  try { brandId = BigInt(brandIdRaw); } catch { throw BadRequest("Invalid brandId"); }

  // Validate the brand belongs to the org before staging anything.
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { orgId: true } });
  if (!brand || brand.orgId !== orgId) throw BadRequest("Invalid brandId");

  const source: ImportSource = file.name.toLowerCase().endsWith(".xlsx") ? "EXCEL" : "CSV";
  const buffer = Buffer.from(await file.arrayBuffer());

  // Cheap up-front validation so obviously-bad files fail fast.
  let rowCount = 0;
  try { rowCount = (await parseTabular(buffer)).length; } catch { throw BadRequest("Could not parse file"); }
  if (rowCount === 0) throw BadRequest("File has no data rows");

  const filePath = await stageFile(orgId, file.name, buffer);
  const job = await prisma.importJob.create({
    data: {
      orgId, brandId, source, dataType, platformSlug: platform,
      fileName: file.name, filePath, status: "QUEUED", rowsTotal: rowCount,
    },
  });

  await writeAudit({ userId: session.userId, orgId, action: `import.${dataType}.enqueue`, target: platform, meta: { importJobId: job.id.toString(), rows: rowCount } });

  if (queuesEnabled()) {
    const queueJobId = await enqueueImport(job.id);
    await prisma.importJob.update({ where: { id: job.id }, data: { queueJobId } });
    return ok({ importJobId: job.id, status: "QUEUED", async: true }, { status: 202 });
  }

  // Fallback: no Redis — process inline synchronously.
  const summary = await processImportJob(job.id);
  const finalJob = await prisma.importJob.findUnique({ where: { id: job.id }, select: { status: true, duplicates: true } });
  return ok({ ...summary, status: finalJob?.status, async: false, duplicatesMerged: finalJob?.duplicates ?? 0 }, { status: 201 });
});

// Import history for the active org.
export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const url = new URL(req.url);
  const orgId = resolveOrgId(session, url.searchParams.get("orgId"));
  await requirePermission(session, orgId, "integration:read");

  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? 20)));
  const q = url.searchParams.get("q")?.trim(); const status = url.searchParams.get("status"); const dataType = url.searchParams.get("dataType"); const platform = url.searchParams.get("platform");
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  const where = { orgId, ...(q ? { fileName: { contains: q, mode: "insensitive" as const } } : {}), ...(status ? { status: status as any } : {}), ...(dataType ? { dataType } : {}), ...(platform ? { platformSlug: platform } : {}), ...((from || to) ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
  const [results, total] = await Promise.all([
    prisma.importJob.findMany({
      where, orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, source: true, dataType: true, platformSlug: true, status: true, fileName: true, progress: true, attempts: true, rowsTotal: true, rowsOk: true, rowsFailed: true, duplicates: true, validationSummary: true, mappingTemplate: { select: { id: true, name: true } }, createdAt: true, finishedAt: true },
    }),
    prisma.importJob.count({ where }),
  ]);
  return ok({ results, meta: { total_items: total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) } });
});
