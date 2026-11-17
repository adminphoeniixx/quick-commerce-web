// Connects the extension to the local browser-bridge MCP server and executes its
// commands in the user's own Chrome. Only allow-listed seller-panel sites are touched.
import { getConfig, addLog, platformFromUrl } from "./lib.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SELLER_TAB_PATTERNS = [
  "https://*.blinkit.com/*", "https://*.grofers.com/*", "https://*.zeptonow.com/*",
  "https://*.swiggy.com/*", "https://*.bigbasket.com/*",
];
let polling = false;

async function sellerTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!platformFromUrl(tab.url)) throw new Error("Tab is not an allowed seller panel");
  return tab;
}

function waitTabComplete(tabId, timeout = 60000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(); };
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

// --- functions injected into the page (must be self-contained) ---

function pageSnapshot(maxText) {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sel = "a,button,input,select,textarea,[role=button],[role=tab],[role=option],[role=menuitem],[role=checkbox],[onclick]";
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el) || n >= 300) continue;
    const ref = `e${++n}`;
    el.setAttribute("data-qcp-ref", ref);
    elements.push({
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || undefined,
      type: el.type || undefined,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").trim().slice(0, 80) || undefined,
      placeholder: el.placeholder || undefined,
      href: el.href ? el.href.slice(0, 200) : undefined,
    });
  }
  const text = (document.body?.innerText || "").replace(/\n{2,}/g, "\n").trim();
  const low = (text.slice(0, 5000) + " " + document.title).toLowerCase();
  return {
    url: location.href,
    title: document.title,
    flags: {
      blocked: /access denied|you have been blocked|attention required|cloudflare ray id/.test(low),
      captcha: !!document.querySelector("iframe[src*='captcha'],iframe[src*='turnstile'],.g-recaptcha,.h-captcha") || /verify you are human/.test(low),
      loginPage: !!document.querySelector("input[type=password]") || /enter otp|send otp|login to continue|sign in to continue/.test(low),
    },
    text: text.slice(0, maxText),
    elements,
  };
}

function pageClick(ref) {
  const el = document.querySelector(`[data-qcp-ref="${ref}"]`);
  if (!el) throw new Error(`ref ${ref} not found; take a new snapshot`);
  el.scrollIntoView({ block: "center" });
  el.click();
  return { clicked: ref };
}

function pageFill(ref, value) {
  const el = document.querySelector(`[data-qcp-ref="${ref}"]`);
  if (!el) throw new Error(`ref ${ref} not found; take a new snapshot`);
  if (el.type === "password" || /otp/i.test(el.name + el.id + el.placeholder)) throw new Error("Refusing to fill password/OTP fields");
  if (el.tagName === "SELECT") {
    el.value = value;
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { filled: ref };
}

async function inPage(tabId, func, args) {
  await sellerTab(tabId);
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res.result;
}

// --- command handlers ---

const handlers = {
  async list_tabs() {
    const tabs = await chrome.tabs.query({ url: SELLER_TAB_PATTERNS });
    return tabs.map((t) => ({ tabId: t.id, url: t.url, title: t.title, platform: platformFromUrl(t.url) }));
  },
  async open({ url }) {
    if (!platformFromUrl(url)) throw new Error("URL not allowed");
    const host = new URL(url).hostname;
    const [existing] = (await chrome.tabs.query({ url: SELLER_TAB_PATTERNS })).filter((t) => new URL(t.url).hostname === host);
    const tab = existing
      ? await chrome.tabs.update(existing.id, { url, active: true })
      : await chrome.tabs.create({ url, active: true });
    await waitTabComplete(tab.id);
    return { tabId: tab.id, url };
  },
  async open_magic_link({ url }) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "brands.blinkit.com" || parsed.hostname.endsWith(".blinkit.com"))) {
      throw new Error("Invalid Blinkit Brands magic link");
    }
    const [existing] = await chrome.tabs.query({ url: ["https://brands.blinkit.com/*", "https://*.blinkit.com/*"] });
    const tab = existing
      ? await chrome.tabs.update(existing.id, { url, active: true })
      : await chrome.tabs.create({ url, active: true });
    await waitTabComplete(tab.id, 90000);
    const finalTab = await chrome.tabs.get(tab.id);
    // Do not return finalTab.url: it may still contain the one-time bearer token.
    return { tabId: tab.id, host: new URL(finalTab.url).hostname, title: finalTab.title };
  },
  snapshot: ({ tabId, maxText }) => inPage(tabId, pageSnapshot, [maxText]),
  click: ({ tabId, ref }) => inPage(tabId, pageClick, [ref]),
  fill: ({ tabId, ref, value }) => inPage(tabId, pageFill, [ref, value]),
  async recent_uploads({ sinceMinutes }) {
    const cfg = await getConfig();
    const since = Date.now() - sinceMinutes * 60000;
    return {
      log: cfg.log.filter((l) => l.at >= since).map((l) => ({ at: new Date(l.at).toISOString(), level: l.level, message: l.message })),
      pending: cfg.pending.map((p) => ({ fileName: p.fileName, error: p.error })),
    };
  },
};

async function execute(cmd) {
  const handler = handlers[cmd.tool];
  if (!handler) return { id: cmd.id, ok: false, error: `unknown tool ${cmd.tool}` };
  try {
    return { id: cmd.id, ok: true, data: await handler(cmd.args || {}) };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e.message };
  }
}

export async function startBridge() {
  if (polling) return;
  const { bridgeUrl, bridgeToken } = await getConfig();
  if (!bridgeToken) return;
  polling = true;
  const headers = { "x-bridge-token": bridgeToken };
  let failures = 0;
  try {
    // Stop after ~1 min of failures (bridge not running); the alarm restarts us later.
    while (failures < 6) {
      let res;
      try {
        res = await fetch(`${bridgeUrl}/poll`, { headers });
      } catch {
        failures++; await sleep(10000); continue;
      }
      if (res.status === 401) { await addLog("error", "Bridge token rejected"); break; }
      failures = 0;
      if (res.status !== 200) continue;
      const cmd = await res.json();
      const out = await execute(cmd);
      await fetch(`${bridgeUrl}/result`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(out) }).catch(() => {});
    }
  } finally {
    polling = false;
  }
}
