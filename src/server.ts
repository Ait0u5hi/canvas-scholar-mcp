import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CanvasConfig } from "./lib/config.js";
import { CanvasClient } from "./lib/canvas-client.js";
import { registerTools } from "./tools/register.js";

/**
 * Construct a fully-wired MCP server (the read-only Canvas tool surface) for a
 * given config. Transport-agnostic: the same server is used over stdio and over
 * the HTTP transport, so the tool wiring stays identical across both.
 */
export function createServer(config: CanvasConfig): McpServer {
  const client = new CanvasClient(config);

  const server = new McpServer({
    name: "canvas-scholar-mcp",
    version: "0.1.0",
  });

  registerTools(server, client);

  return server;
}
