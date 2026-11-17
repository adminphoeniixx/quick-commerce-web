// Isolated-world content script on the Blinkit seller panel:
//  1. relays blob reads between the background worker and page-hook.js
//  2. runs the configured report steps (click / fill / wait) when "Run all" is used

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function readBlob(url) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.source !== window || e.data?.source !== "qcp-page" || e.data.id !== id) return;
      window.removeEventListener("message", onMsg);
      resolve(e.data.error ? { error: e.data.error } : { b64: bufToB64(e.data.buf) });
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "qcp-ext", type: "get-blob", url, id }, "*");
    setTimeout(() => { window.removeEventListener("message", onMsg); resolve({ error: "timeout" }); }, 10000);
  });
}

// {{today}}, {{yesterday}}, {{daysAgo:7}}; optional format: {{daysAgo:7|DD/MM/YYYY}}
function render(value) {
  return String(value).replace(/\{\{(today|yesterday|daysAgo:(\d+))(?:\|([^}]+))?\}\}/g, (_, key, n, fmt) => {
    const days = key === "today" ? 0 : key === "yesterday" ? 1 : Number(n);
    const d = new Date(Date.now() - days * 86400000);
    const pad = (x) => String(x).padStart(2, "0");
    return (fmt || "YYYY-MM-DD")
      .replace("YYYY", d.getFullYear())
      .replace("MM", pad(d.getMonth() + 1))
      .replace("DD", pad(d.getDate()));
  });
}

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function findByText(text) {
  const t = text.trim().toLowerCase();
  const matches = [...document.querySelectorAll("button,a,label,li,span,div,p,[role]")]
    .filter((el) => visible(el) && el.innerText?.trim().toLowerCase() === t);
  // Prefer the innermost element whose text matches.
  return matches.find((el) => !matches.some((o) => o !== el && el.contains(o))) || null;
}

async function waitForEl(step, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const el = step.selector ? document.querySelector(step.selector) : findByText(render(step.text));
    if (el && visible(el)) return el;
    await sleep(300);
  }
  throw new Error(`not found: ${step.selector || step.text}`);
}

function setInputValue(el, value) {
  // React-controlled inputs need the native setter + input/change events.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function runSteps(steps) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    try {
      if (s.action === "wait") { await sleep(s.ms ?? 1000); continue; }
      const el = await waitForEl(s, s.timeout);
      if (s.action === "click") el.click();
      else if (s.action === "fill") setInputValue(el, render(s.value));
      else if (s.action === "select") { el.value = render(s.value); el.dispatchEvent(new Event("change", { bubbles: true })); }
      else if (s.action !== "waitFor") throw new Error(`unknown action: ${s.action}`);
      await sleep(s.after ?? 800);
    } catch (e) {
      return { ok: false, step: i, error: e.message };
    }
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "qcp:get-blob") { readBlob(msg.url).then(sendResponse); return true; }
  if (msg.type === "qcp:run-steps") { runSteps(msg.steps).then(sendResponse); return true; }
  if (msg.type === "qcp:ping") { sendResponse({ ok: true, url: location.href }); }
});
