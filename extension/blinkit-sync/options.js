import { getConfig, setConfig, DATA_TYPES } from "./lib.js";

const $ = (id) => document.getElementById(id);

const cfg = await getConfig();
$("appUrl").value = cfg.appUrl;
$("pauseMs").value = cfg.pauseMs;
$("bridgeToken").value = cfg.bridgeToken;
$("genToken").onclick = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  $("bridgeToken").value = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
$("rules").value = JSON.stringify(cfg.rules, null, 2);
$("reports").value = JSON.stringify(cfg.reports, null, 2);

$("save").onclick = async () => {
  $("msg").textContent = "";
  try {
    const appUrl = $("appUrl").value.trim().replace(/\/+$/, "");
    const origin = new URL(appUrl).origin + "/*";
    // Chrome only shows this prompt for origins not already in host_permissions.
    if (!(await chrome.permissions.request({ origins: [origin] }))) throw new Error(`Permission denied for ${origin}`);

    const rules = JSON.parse($("rules").value);
    if (!Array.isArray(rules) || rules.some((r) => !r.pattern || !DATA_TYPES.includes(r.dataType)))
      throw new Error(`Each rule needs "pattern" and a dataType of: ${DATA_TYPES.join(", ")}`);

    const reports = JSON.parse($("reports").value);
    if (!Array.isArray(reports) || reports.some((r) => !r.name || !r.url || !Array.isArray(r.steps)))
      throw new Error('Each report needs "name", "url" and "steps"');

    const pauseMs = Math.max(2000, Number($("pauseMs").value) || 5000);
    const bridgeToken = $("bridgeToken").value.trim();
    if (bridgeToken && bridgeToken.length < 20) throw new Error("Bridge token must be at least 20 characters");
    await setConfig({ appUrl, pauseMs, rules, reports, bridgeToken });
    $("msg").textContent = "Saved";
    $("msg").className = "ok";
  } catch (e) {
    $("msg").textContent = e.message;
    $("msg").className = "error";
  }
};
