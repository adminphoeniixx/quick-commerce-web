import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Bridge } from "./bridge.js";

// Seller panels the browser tools may touch. The extension enforces the same list.
export const ALLOWED_HOSTS = ["blinkit.com", "grofers.com", "zeptonow.com", "swiggy.com", "bigbasket.com"];

export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Magic links are bearer credentials: accept only Blinkit's brands portal/auth hosts. */
export function isBlinkitBrandsMagicLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "brands.blinkit.com" || u.hostname.endsWith(".blinkit.com"));
  } catch {
    return false;
  }
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function createServer(bridge: Bridge): McpServer {
  const server = new McpServer({ name: "qcp-browser-bridge", version: "0.1.0" });
  const tabId = z.number().int().describe("Tab id from browser_list_tabs or browser_open");

  server.registerTool("browser_status", {
    description: "Whether the QCP Chrome extension is connected to this bridge.",
    inputSchema: {},
  }, async () => result({ connected: bridge.connected }));

  server.registerTool("browser_list_tabs", {
    description: "List open seller-panel tabs (Blinkit, Zepto, Instamart, BigBasket) in the user's Chrome.",
    inputSchema: {},
  }, async () => result(await bridge.send("list_tabs")));

  server.registerTool("browser_open", {
    description: "Open a seller-panel URL. Reuses an existing tab on the same site when there is one. Only allowed seller domains.",
    inputSchema: { url: z.string().url() },
  }, async ({ url }) => {
    if (!isAllowedUrl(url)) throw new Error(`URL not allowed: ${url}`);
    return result(await bridge.send("open", { url }, 90_000));
  });

  server.registerTool("blinkit_brands_login_magic_link", {
    description:
      "Consume a user-provided Blinkit Brands email magic link in the existing QCP Chrome profile. " +
      "The link is a secret: never repeat, log, or persist it. Call only after the user explicitly provides the fresh link.",
    inputSchema: { magicLink: z.string().url().describe("Fresh login URL received from Blinkit Brands email; treated as a secret") },
  }, async ({ magicLink }) => {
    if (!isBlinkitBrandsMagicLink(magicLink)) throw new Error("Magic link must be an HTTPS URL on brands.blinkit.com or another blinkit.com host");
    const state = await bridge.send("open_magic_link", { url: magicLink }, 90_000) as Record<string, unknown>;
    // Never return the credential URL, including a redirect URL containing its token.
    return result({ tabId: state.tabId, opened: true, host: state.host, title: state.title });
  });

  server.registerTool("browser_snapshot", {
    description:
      "Read a tab: url, title, visible text (truncated) and interactive elements with a `ref` to use in click/fill. " +
      "`flags` reports blocked / captcha / login pages: if any is true, stop and report to the user.",
    inputSchema: { tabId, maxText: z.number().int().min(500).max(20000).optional() },
  }, async ({ tabId, maxText }) => result(await bridge.send("snapshot", { tabId, maxText: maxText ?? 6000 })));

  server.registerTool("browser_click", {
    description: "Click an element by ref from the latest browser_snapshot of that tab.",
    inputSchema: { tabId, ref: z.string() },
  }, async ({ tabId, ref }) => result(await bridge.send("click", { tabId, ref })));

  server.registerTool("browser_fill", {
    description: "Type a value into an input/select by ref. Never use this for passwords or OTPs.",
    inputSchema: { tabId, ref: z.string(), value: z.string().max(200) },
  }, async ({ tabId, ref, value }) => result(await bridge.send("fill", { tabId, ref, value })));

  server.registerTool("browser_wait", {
    description: "Wait for the page (e.g. after clicking Download or changing a filter).",
    inputSchema: { ms: z.number().int().min(250).max(15000) },
  }, async ({ ms }) => {
    await new Promise((r) => setTimeout(r, ms));
    return result({ waited: ms });
  });

  server.registerTool("qcp_recent_uploads", {
    description:
      "Files the extension captured from seller-panel downloads and uploaded to the QCP database, " +
      "plus anything waiting in Pending. Use after triggering a download to confirm it reached the DB.",
    inputSchema: { sinceMinutes: z.number().int().min(1).max(1440).optional() },
  }, async ({ sinceMinutes }) => result(await bridge.send("recent_uploads", { sinceMinutes: sinceMinutes ?? 15 })));

  return server;
}
