import { prisma } from "@/lib/db";
import { handler, ok, BadRequest } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { requireVerifiedEmail } from "@/lib/auth/verified";
import { assertFileFormat, parseTabularSheet } from "@/lib/ingest/parse";
import { stageFile } from "@/lib/ingest/staging";
import { canonicalFields, suggestMapping } from "@/lib/ingest/mapping";
import type { DataType } from "@/lib/ingest/contracts";
import type { PlatformSlug } from "@/lib/types";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const MAX_BYTES = Number(process.env.IMPORT_MAX_BYTES || 10 * 1024 * 1024);
const TYPES = ["sales", "availability", "pricing", "visibility", "products"];
const PLATFORMS = ["blinkit", "zepto", "instamart", "bigbasket"];

export const POST = handler(async (req) => {
  const session = await requireSession(req); assertCsrf(req); await requireVerifiedEmail(session);
  const orgId = resolveOrgId(session); await requirePermission(session, orgId, "integration:create");
  await rateLimit(`import-preview:${orgId}:${session.userId}`, 10, 60);
  const form = await req.formData().catch(() => null); if (!form) throw BadRequest("Expected multipart/form-data");
  const file = form.get("file"), selectedSheet = String(form.get("sheet") || "") || undefined;
  const dataType = String(form.get("dataType") || "") as DataType, platform = String(form.get("platform") || "") as PlatformSlug;
  if (!(file instanceof File)) throw BadRequest("Choose a CSV or XLSX file");
  if (!file.size) throw BadRequest("The uploaded file is empty");
  if (file.size > MAX_BYTES) throw BadRequest(`File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit`);
  if (!TYPES.includes(dataType) || !PLATFORMS.includes(platform)) throw BadRequest("Invalid data type or platform");
  let brandId: bigint; try { brandId = BigInt(String(form.get("brandId") || "")); } catch { throw BadRequest("Invalid brand") }
  const brand = await prisma.brand.findFirst({ where: { id: brandId, orgId } }); if (!brand) throw BadRequest("Invalid brand");
  const buffer = Buffer.from(await file.arrayBuffer());
  let source: "CSV" | "EXCEL"; try { source = assertFileFormat(file.name, buffer); } catch (e) { throw BadRequest(e instanceof Error ? e.message : "Invalid file") }
  let parsed; try { parsed = await parseTabularSheet(buffer, selectedSheet); } catch (e) { throw BadRequest(e instanceof Error ? e.message : "Could not parse file") }
  if (!parsed.rows.length) throw BadRequest("File has no data rows");
  const normalized = parsed.headers.map((h) => h.trim().toLowerCase());
  const duplicates = parsed.headers.filter((_, i) => normalized.indexOf(normalized[i]) !== i);
  if (duplicates.length) throw BadRequest(`Duplicate headers: ${[...new Set(duplicates)].join(", ")}`);
  const filePath = await stageFile(orgId, file.name, buffer);
  const job = await prisma.importJob.create({ data: { orgId, brandId, source, dataType, platformSlug: platform, fileName: file.name, filePath, status: "STAGED", rowsTotal: parsed.rows.length, selectedSheet: parsed.selectedSheet, retentionUntil: new Date(Date.now() + 7 * 86400000) } });
  return ok({ importJobId: job.id, fileName: file.name, sheets: parsed.sheetNames, selectedSheet: parsed.selectedSheet, headers: parsed.headers, preview: parsed.rows.slice(0, 100), totalRows: parsed.rows.length, suggestions: suggestMapping(parsed.headers, dataType), fields: canonicalFields(dataType) }, { status: 201 });
});
