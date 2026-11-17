// Browser API client: sends cookies, attaches CSRF on mutations, and transparently
// refreshes the access token once on a 401 before retrying.
"use client";

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function raw(method: Method, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const csrf = readCookie("qcp_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  return fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function api<T = any>(method: Method, path: string, body?: unknown): Promise<T> {
  let res = await raw(method, path, body);
  if (res.status === 401 && path !== "/api/auth/refresh") {
    const refreshed = await raw("POST", "/api/auth/refresh");
    if (refreshed.ok) res = await raw(method, path, body);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status === "error") {
    throw new ApiError(res.status, json?.code ?? "error", json?.message ?? "Request failed", json?.details);
  }
  return json.data as T;
}

const getInFlight = new Map<string, Promise<any>>();
export const apiGet = <T = any>(p: string): Promise<T> => {
  const existing = getInFlight.get(p); if (existing) return existing as Promise<T>;
  const request = api<T>("GET", p); getInFlight.set(p, request);
  request.then(() => setTimeout(() => getInFlight.delete(p), 250), () => setTimeout(() => getInFlight.delete(p), 250));
  return request;
};
export const apiPost = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b);
export const apiPatch = <T = any>(p: string, b?: unknown) => api<T>("PATCH", p, b);
export const apiDelete = <T = any>(p: string, b?: unknown) => api<T>("DELETE", p, b);
