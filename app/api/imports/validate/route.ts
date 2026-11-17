import { readFile } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest, NotFound, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { parseTabularSheet } from "@/lib/ingest/parse";
import { validateMapping, validationSummary } from "@/lib/ingest/mapping";
import type { DataType } from "@/lib/ingest/contracts"; import type { PlatformSlug } from "@/lib/types";
import { rateLimit } from "@/lib/ratelimit";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const schema = z.object({ importJobId: z.string().regex(/^\d+$/), mapping: z.record(z.string(), z.string()), templateId: z.string().regex(/^\d+$/).optional() });
export const POST = handler(async (req) => {
  const session = await requireSession(req); assertCsrf(req); const body = await parseBody(req, schema); const id = BigInt(body.importJobId);
  const job = await prisma.importJob.findUnique({ where: { id } }); if (!job) throw NotFound("Import not found");
  await requirePermission(session, job.orgId, "integration:create"); if (!job.filePath || !job.platformSlug) throw BadRequest("Staged file is unavailable");
  await rateLimit(`import-validate:${job.orgId}:${session.userId}`, 30, 60);
  const mappingErrors = validateMapping(body.mapping, job.dataType as DataType); if (mappingErrors.length) throw BadRequest("Mapping is incomplete", mappingErrors);
  if (body.templateId) { const t = await prisma.importMappingTemplate.findFirst({ where: { id: BigInt(body.templateId), orgId: job.orgId } }); if (!t) throw BadRequest("Mapping template is not compatible"); }
  const parsed = await parseTabularSheet(await readFile(job.filePath), job.selectedSheet || undefined);
  const summary = validationSummary(parsed.rows, body.mapping, job.dataType as DataType, job.platformSlug as PlatformSlug);
  await prisma.importJob.update({ where: { id }, data: { status: "VALIDATED", mappingJson: body.mapping, validationSummary: JSON.parse(JSON.stringify(summary)), mappingTemplateId: body.templateId ? BigInt(body.templateId) : null } });
  return ok(summary);
});
