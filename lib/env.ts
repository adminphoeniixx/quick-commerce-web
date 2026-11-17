import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().refine(v => v.startsWith("postgresql://") || v.startsWith("postgres://"), "must be a PostgreSQL URL"),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  IMPORT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  IMPORT_MAX_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  IMPORT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export function validateEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (result.data.NODE_ENV === "production" && !result.data.REDIS_URL) throw new Error("Invalid environment: REDIS_URL is required in production");
  return result.data;
}
