export type LogLevel = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

function clean(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: process.env.NODE_ENV === "production" ? undefined : value.stack };
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Meta).filter(([key]) => !/password|secret|token|credential|authorization|cookie/i.test(key)).map(([key, item]) => [key, clean(item)]));
  return value;
}

export function log(level: LogLevel, message: string, meta: Meta = {}): void {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...clean(meta) as Meta });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

export const logger = {
  debug: (message: string, meta?: Meta) => { if (process.env.LOG_LEVEL === "debug") log("debug", message, meta); },
  info: (message: string, meta?: Meta) => log("info", message, meta),
  warn: (message: string, meta?: Meta) => log("warn", message, meta),
  error: (message: string, meta?: Meta) => log("error", message, meta),
};
