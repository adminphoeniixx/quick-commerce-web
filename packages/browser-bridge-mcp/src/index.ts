import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bridge } from "./bridge.js";
import { createServer } from "./server.js";

const token = process.env.QCP_BRIDGE_TOKEN;
if (!token || token.length < 20) {
  process.stderr.write("QCP_BRIDGE_TOKEN (min 20 chars) is required\n");
  process.exit(1);
}
const bridge = new Bridge(Number(process.env.QCP_BRIDGE_PORT ?? 8765), token);
await bridge.start();
const server = createServer(bridge);
await server.connect(new StdioServerTransport());
process.on("SIGTERM", () => { bridge.stop(); process.exit(0); });
