// Safe server-side staging for uploaded files. Stored per-tenant; the worker
// deletes each file after processing (retention = until processed).
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(/* turbopackIgnore: true */ process.env.IMPORT_STAGING_DIR || path.join(process.cwd(), ".import-staging"));

export async function stageFile(orgId: bigint, originalName: string, buffer: Buffer): Promise<string> {
  const dir = path.join(/* turbopackIgnore: true */ ROOT, orgId.toString());
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const inputExt = path.extname(originalName).toLowerCase();
  if (!new Set([".csv", ".xlsx"]).has(inputExt)) throw new Error("Unsupported staged file extension");
  const ext = inputExt;
  const filePath = path.join(/* turbopackIgnore: true */ dir, `${randomUUID()}${ext}`);
  if (!filePath.startsWith(`${dir}${path.sep}`)) throw new Error("Invalid staging path");
  await writeFile(filePath, buffer, { mode: 0o600 });
  return filePath;
}
