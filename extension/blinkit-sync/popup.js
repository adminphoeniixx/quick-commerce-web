import { getConfig, setConfig, appFetch, runsInLastDay, DATA_TYPES, MAX_RUNS_PER_DAY } from "./lib.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
}

async function loadStatus(cfg) {
  try {
    const me = await appFetch(cfg.appUrl, "/api/auth/me");
    $("appStatus").textContent = `QCP: ${me.user.email}`;
    $("appStatus").className = "ok";
    const { brands } = await appFetch(cfg.appUrl, "/api/brands");
    for (const b of brands) $("brand").append(el("option", { value: b.id, textContent: b.name }));
    $("brand").value = cfg.brandId;
  } catch (e) {
    $("appStatus").textContent = `QCP: not logged in at ${cfg.appUrl} (${e.message})`;
    $("appStatus").className = "error";
  }
  const tabs = await chrome.tabs.query({ url: "https://*.blinkit.com/*" });
  $("blinkitStatus").textContent = tabs.length ? "Blinkit panel: open" : "Blinkit panel: not open";
}

function renderRun(cfg) {
  const used = runsInLastDay(cfg.runs).length;
  $("runInfo").textContent = cfg.reports.length
    ? `${used}/${MAX_RUNS_PER_DAY} runs used in last 24h · ${cfg.reports.length} reports configured`
    : "No reports configured yet (Settings → Reports)";
  $("runAll").disabled = !cfg.reports.length || used >= MAX_RUNS_PER_DAY;
}

function renderPending(cfg) {
  $("pendingWrap").hidden = !cfg.pending.length;
  $("pending").replaceChildren(...cfg.pending.map((p) => {
    const type = el("select", {}, DATA_TYPES.map((t) => el("option", { value: t, textContent: t })));
    const upload = el("button", { textContent: "Upload" });
    const discard = el("button", { textContent: "✕", className: "secondary" });
    upload.onclick = async () => {
      upload.disabled = true;
      const res = await chrome.runtime.sendMessage({ type: "qcp:upload-pending", id: p.id, dataType: type.value });
      if (!res.ok) alert(res.error);
    };
    discard.onclick = async () => {
      const { pending } = await getConfig();
      await setConfig({ pending: pending.filter((x) => x.id !== p.id) });
    };
    return el("li", {}, [
      el("div", { textContent: `${p.fileName} (${Math.round(p.size / 1024)} KB)` }),
      el("div", { className: "muted", textContent: p.error || "" }),
      el("div", { className: "row" }, [type, upload, discard]),
    ]);
  }));
}

function renderLog(cfg) {
  $("log").replaceChildren(...cfg.log.slice(0, 15).map((l) =>
    el("li", { className: l.level, textContent: `${new Date(l.at).toLocaleTimeString()} ${l.message}` })));
}

async function render() {
  const cfg = await getConfig();
  $("capture").checked = cfg.capture;
  renderRun(cfg);
  renderPending(cfg);
  renderLog(cfg);
}

$("brand").onchange = () => setConfig({ brandId: $("brand").value });
$("capture").onchange = () => setConfig({ capture: $("capture").checked });
$("runAll").onclick = async () => {
  if (!confirm("Run all configured reports now on the open Blinkit tab?")) return;
  $("runAll").disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "qcp:run-all" });
  if (!res.ok) alert(res.error);
};
chrome.storage.onChanged.addListener(render);

const cfg = await getConfig();
await render();
loadStatus(cfg);
