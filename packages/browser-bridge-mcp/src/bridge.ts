// Local HTTP bridge between this MCP process and the QCP Chrome extension.
// The extension long-polls GET /poll for the next command and answers on POST /result.
// Bound to 127.0.0.1 only and every request must carry the shared bridge token.
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

export interface Command { id: string; tool: string; args: Record<string, unknown> }
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

const POLL_HOLD_MS = 25_000;
const CONNECT_WAIT_MS = 45_000;

export class Bridge {
  private queue: Command[] = [];
  private waiters: ((c: Command | null) => void)[] = [];
  private pending = new Map<string, Pending>();
  private lastSeen = 0;
  private server?: http.Server;

  constructor(private port: number, private token: string) {}

  get connected(): boolean {
    return Date.now() - this.lastSeen < POLL_HOLD_MS + 10_000;
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", () => resolve());
    });
  }

  stop(): void {
    this.server?.close();
  }

  private authorized(req: http.IncomingMessage): boolean {
    const got = String(req.headers["x-bridge-token"] ?? "");
    return got.length === this.token.length && timingSafeEqual(Buffer.from(got), Buffer.from(this.token));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.authorized(req)) { res.writeHead(401).end(); return; }
    this.lastSeen = Date.now();

    if (req.method === "GET" && req.url === "/poll") {
      const next = this.queue.shift();
      if (next) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(next)); return; }
      const waiter = (c: Command | null) => {
        clearTimeout(timer);
        if (c) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(c));
        else res.writeHead(204).end();
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        waiter(null);
      }, POLL_HOLD_MS);
      req.on("close", () => { this.waiters = this.waiters.filter((w) => w !== waiter); clearTimeout(timer); });
      this.waiters.push(waiter);
      return;
    }

    if (req.method === "POST" && req.url === "/result") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 5_000_000) req.destroy(); });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body) as { id: string; ok: boolean; data?: unknown; error?: string };
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || "extension error"));
          }
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }

    res.writeHead(404).end();
  }

  private async waitForExtension(): Promise<void> {
    const end = Date.now() + CONNECT_WAIT_MS;
    while (!this.connected && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
    if (!this.connected) throw new Error("QCP extension is not connected to the bridge (is Chrome open with the extension enabled?)");
  }

  async send(tool: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<unknown> {
    await this.waitForExtension();
    const cmd: Command = { id: randomUUID(), tool, args };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.id);
        this.queue = this.queue.filter((c) => c.id !== cmd.id);
        reject(new Error(`${tool} timed out`));
      }, timeoutMs);
      this.pending.set(cmd.id, { resolve, reject, timer });
      const waiter = this.waiters.shift();
      if (waiter) waiter(cmd); else this.queue.push(cmd);
    });
  }
}
