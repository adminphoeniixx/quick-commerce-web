// Service worker: watches Blinkit downloads, uploads them to QCP, and drives "Run all".
import {
  getConfig, setConfig, classify, addLog, uploadImport, platformFromUrl,
  bytesToB64, b64ToBytes, runsInLastDay, MAX_RUNS_PER_DAY,
} from "./lib.js";
import { startBridge } from "./bridge.js";

const SUPPORTED = /\.(csv|xlsx)$/i;
const SELLER_TABS = [
  "https://*.blinkit.com/*", "https://*.grofers.com/*", "https://*.zeptonow.com/*",
  "https://*.swiggy.com/*", "https://*.bigbasket.com/*",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function downloadPlatform(item) {
  for (const u of [item.url, item.finalUrl, item.referrer]) {
    const p = u && platformFromUrl(u);
    if (p) return p;
  }
  return null;
}

async function readDownload(item) {
  const url = item.finalUrl || item.url;
  if (url.startsWith("blob:")) {
    const tabs = await chrome.tabs.query({ url: SELLER_TABS });
    for (const tab of tabs) {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "qcp:get-blob", url }).catch(() => null);
      if (res?.b64) return b64ToBytes(res.b64);
    }
    throw new Error("could not read blob download (Blinkit tab closed?)");
  }
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`download fetch failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function addPending(fileName, platform, bytes, error) {
  const { pending } = await getConfig();
  pending.unshift({ id: crypto.randomUUID(), fileName, platform, b64: bytesToB64(bytes), size: bytes.length, error, at: Date.now() });
  await setConfig({ pending: pending.slice(0, 30) });
}

async function handleDownload(id) {
  const [item] = await chrome.downloads.search({ id });
  const platform = item && downloadPlatform(item);
  if (!platform) return;
  const cfg = await getConfig();
  if (!cfg.capture && Date.now() > cfg.runActiveUntil) return;

  const fileName = item.filename.split(/[\\/]/).pop();
  if (!SUPPORTED.test(fileName)) { await addLog("warn", `Skipped ${fileName}: only .csv/.xlsx are imported`); return; }

  let bytes;
  try { bytes = await readDownload(item); } catch (e) { await addLog("error", `${fileName}: ${e.message}`); return; }

  const dataType = classify(fileName, cfg.rules);
  if (!dataType || !cfg.brandId) {
    await addPending(fileName, platform, bytes, !cfg.brandId ? "Select a brand" : "Choose a data type");
    await addLog("warn", `${fileName}: waiting in Pending`);
    return;
  }
  try {
    const out = await uploadImport({ appUrl: cfg.appUrl, brandId: cfg.brandId, platform, dataType, fileName, bytes });
    await addLog("ok", `${platform}: ${fileName} → ${dataType} (import #${out.importJobId}, ${out.status})`);
  } catch (e) {
    await addPending(fileName, platform, bytes, e.message);
    await addLog("error", `${fileName}: ${e.message} (moved to Pending)`);
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete") handleDownload(delta.id);
});

function waitTabComplete(tabId, timeout = 60000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(); };
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

async function sendWithRetry(tabId, msg, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const res = await chrome.tabs.sendMessage(tabId, msg).catch(() => null);
    if (res) return res;
    await sleep(500);
  }
  throw new Error("Blinkit page did not respond");
}

async function runAll() {
  const cfg = await getConfig();
  const recent = runsInLastDay(cfg.runs);
  if (recent.length >= MAX_RUNS_PER_DAY) throw new Error(`Limit reached: ${MAX_RUNS_PER_DAY} runs per 24h`);
  if (!cfg.reports.length) throw new Error("No reports configured (Options → Reports)");
  if (!cfg.brandId) throw new Error("Select a brand first");

  const [tab] = await chrome.tabs.query({ url: "https://*.blinkit.com/*" });
  if (!tab) throw new Error("Open the Blinkit seller panel and log in first");

  await setConfig({ runs: [...recent, Date.now()], runActiveUntil: Date.now() + 15 * 60 * 1000 });
  await addLog("info", `Run started (${cfg.reports.length} reports)`);
  let failed = 0;
  for (const report of cfg.reports) {
    await chrome.tabs.update(tab.id, { url: report.url, active: true });
    await waitTabComplete(tab.id);
    const res = await sendWithRetry(tab.id, { type: "qcp:run-steps", steps: report.steps || [] });
    if (res.ok) await addLog("info", `${report.name}: download triggered`);
    else { failed++; await addLog("error", `${report.name}: step ${res.step + 1} failed — ${res.error}`); }
    await sleep(cfg.pauseMs);
  }
  // Give the last downloads time to finish before capture-only-during-run ends.
  await sleep(10000);
  await setConfig({ runActiveUntil: Date.now() + 60000 });
  await addLog(failed ? "warn" : "ok", `Run finished: ${cfg.reports.length - failed}/${cfg.reports.length} reports`);
}

async function uploadPending(id, dataType) {
  const cfg = await getConfig();
  const item = cfg.pending.find((p) => p.id === id);
  if (!item) throw new Error("Pending file not found");
  if (!cfg.brandId) throw new Error("Select a brand first");
  const out = await uploadImport({ appUrl: cfg.appUrl, brandId: cfg.brandId, platform: item.platform || "blinkit", dataType, fileName: item.fileName, bytes: b64ToBytes(item.b64) });
  const { pending } = await getConfig();
  await setConfig({ pending: pending.filter((p) => p.id !== id) });
  await addLog("ok", `${item.fileName} → ${dataType} (import #${out.importJobId}, ${out.status})`);
}

// Keep the bridge poller alive: MV3 workers sleep when idle, the alarm wakes them.
chrome.alarms.create("qcp-bridge", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "qcp-bridge") startBridge(); });
chrome.runtime.onStartup.addListener(startBridge);
chrome.storage.onChanged.addListener((changes) => { if (changes.bridgeToken) startBridge(); });
startBridge();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const job =
    msg.type === "qcp:run-all" ? runAll() :
    msg.type === "qcp:upload-pending" ? uploadPending(msg.id, msg.dataType) :
    null;
  if (!job) return;
  job.then(() => sendResponse({ ok: true }))
    .catch(async (e) => { await addLog("error", e.message); sendResponse({ ok: false, error: e.message }); });
  return true;
});
