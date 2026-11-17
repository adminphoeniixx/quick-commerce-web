// Consistent API response envelope, typed errors, and safe JSON (BigInt-aware).
import { NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";
import { Prisma } from "@prisma/client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const Unauthorized = (m = "Authentication required") => new ApiError(401, "unauthorized", m);
export const Forbidden = (m = "You do not have permission to do this") => new ApiError(403, "forbidden", m);
export const NotFound = (m = "Not found") => new ApiError(404, "not_found", m);
export const BadRequest = (m = "Invalid request", d?: unknown) => new ApiError(400, "bad_request", m, d);
export const Conflict = (m = "Conflict") => new ApiError(409, "conflict", m);
export const TooMany = (m = "Too many requests") => new ApiError(429, "rate_limited", m);

// Recursively convert BigInt → string so responses serialize cleanly.
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}

export function ok<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json({ status: "success", data: normalize(data) }, { status: init?.status ?? 200 });
}

export function fail(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { status: "error", code: err.code, message: err.message, details: normalize(err.details) },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { status: "error", code: "validation", message: "Validation failed", details: err.flatten() },
      { status: 422 },
    );
  }
  // Never leak internals.
  console.error("[api] unexpected error:", err);
  return NextResponse.json({ status: "error", code: "internal", message: "Something went wrong" }, { status: 500 });
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw BadRequest("Request body must be valid JSON");
  }
  return schema.parse(json);
}

/** Wrap a route handler so thrown ApiError/ZodError become proper responses. */
export function handler(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      // Next 16 passes dynamic route params as a Promise; resolve it once for every route.
      const params = ctx?.params ? await ctx.params : ctx?.params;
      return await fn(req, { ...ctx, params });
    } catch (e) {
      return fail(e);
    }
  };
}
