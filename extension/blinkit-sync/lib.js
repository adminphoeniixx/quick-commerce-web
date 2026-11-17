// Shared config, classification and QCP API helpers (used by background, popup, options).

export const DATA_TYPES = ["sales", "availability", "pricing", "visibility"];
export const MAX_RUNS_PER_DAY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// Seller-panel host → QCP platform slug. Anything else is never touched or captured.
const PLATFORM_HOSTS = [
  ["blinkit.com", "blinkit"], ["grofers.com", "blinkit"], ["zeptonow.com", "zepto"],
  ["swiggy.com", "instamart"], ["bigbasket.com", "bigbasket"],
];

export function platformFromUrl(raw) {
  try {
    const u = new URL(String(raw).replace(/^blob:/, ""));
    if (u.protocol !== "https:") return null;
    const hit = PLATFORM_HOSTS.find(([h]) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    return hit ? hit[1] : null;
  } catch {
    return null;
  }
}

export const DEFAULTS = {
  appUrl: "http://localhost:3000",
  bridgeUrl: "http://127.0.0.1:8765",
  bridgeToken: "",
  brandId: "",
  capture: true,
  pauseMs: 5000,
  // First matching rule (case-insensitive regex on the file name) decides the data type.
  rules: [
    { pattern: "sales|order", dataType: "sales" },
    { pattern: "inventory|stock|availability", dataType: "availability" },
    { pattern: "price|pricing", dataType: "pricing" },
    { pattern: "keyword|search|visibility|sov", dataType: "visibility" },
  ],
  // Filled in once the seller-panel report screens are known. See README.
  reports: [],
  runs: [],
  runActiveUntil: 0,
  pending: [],
  log: [],
};

export async function getConfig() {
  return chrome.storage.local.get(DEFAULTS);
}

export async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

export function classify(fileName, rules) {
  for (const r of rules) {
    try {
      if (new RegExp(r.pattern, "i").test(fileName)) return r.dataType;
    } catch { /* invalid user regex: skip */ }
  }
  return null;
}

export function runsInLastDay(runs) {
  return runs.filter((t) => Date.now() - t < DAY_MS);
}

export async function addLog(level, message) {
  const { log } = await getConfig();
  log.unshift({ at: Date.now(), level, message });
  await setConfig({ log: log.slice(0, 50) });
}

export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Calls the QCP API with the user's existing QCP login cookies. Mutations send the
// double-submit CSRF header; on 401 the session is refreshed once and retried.
export async function appFetch(appUrl, path, init = {}) {
  const base = appUrl.replace(/\/+$/, "");
  const send = async () => {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== "GET") {
      const csrf = await chrome.cookies.get({ url: base, name: "qcp_csrf" });
      if (csrf) headers.set("x-csrf-token", csrf.value);
    }
    return fetch(base + path, { ...init, headers, credentials: "include" });
  };
  let res = await send();
  if (res.status === 401) {
    const r = await fetch(base + "/api/auth/refresh", { method: "POST", credentials: "include" });
    if (r.ok) res = await send();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body.data;
}

export async function uploadImport({ appUrl, brandId, platform, dataType, fileName, bytes }) {
  const type = /\.xlsx$/i.test(fileName)
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), fileName);
  fd.append("platform", platform);
  fd.append("dataType", dataType);
  fd.append("brandId", brandId);
  return appFetch(appUrl, "/api/imports", { method: "POST", body: fd });
}
