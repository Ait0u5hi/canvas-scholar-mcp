import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/config.js";
import { CanvasClient } from "./lib/canvas-client.js";
import { registerTools } from "./tools/register.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new CanvasClient(config);

  const server = new McpServer({
    name: "canvas-scholar-mcp",
    version: "0.1.0",
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Never write to stdout — it is the JSON-RPC channel. Diagnostics go to stderr.
  process.stderr.write("canvas-scholar-mcp: connected over stdio\n");
}

main().catch((err) => {
  process.stderr.write(`canvas-scholar-mcp: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
