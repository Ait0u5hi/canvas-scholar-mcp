import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CanvasConfig } from "./lib/config.js";
import { CanvasClient } from "./lib/canvas-client.js";
import { registerTools } from "./tools/register.js";

/**
 * Read the real version from package.json instead of a hardcoded literal —
 * this used to report "0.1.0" regardless of the actual released version.
 * `../package.json` is correct both from source (src/server.ts) and from the
 * bundled output (build/*.js) — tsup keeps every chunk flat in build/, one
 * level below the repo root either way.
 */
function readOwnVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf-8")) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Construct a fully-wired MCP server (the read-only Canvas tool surface) for a
 * given config. Transport-agnostic: the same server is used over stdio and over
 * the HTTP transport, so the tool wiring stays identical across both.
 */
export function createServer(config: CanvasConfig): McpServer {
  const client = new CanvasClient(config);

  const server = new McpServer({
    name: "canvas-scholar-mcp",
    version: readOwnVersion(),
  });

  registerTools(server, client);

  return server;
}
