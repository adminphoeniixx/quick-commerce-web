import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

if (!process.env.QCP_MCP_SERVICE_TOKEN) {
  process.stderr.write("QCP_MCP_SERVICE_TOKEN is required\n");
  process.exit(1);
}
const server = createServer();
await server.connect(new StdioServerTransport());
