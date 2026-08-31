import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

  if (transport === "http") {
    // Optional LAN/remote mode. Lazy-import so the stdio path (and the .mcpb
    // one-click bundle) never pulls in the HTTP stack. See docs: "Remote / LAN".
    const { startHttpServer } = await import("./http.js");

    const authToken = process.env.MCP_AUTH_TOKEN?.trim();
    if (!authToken) {
      throw new Error(
        "MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http — it is the bearer " +
          "token clients must present to reach this server (distinct from CANVAS_API_TOKEN).",
      );
    }
    const host = process.env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
    const port = Number(process.env.MCP_HTTP_PORT ?? 7356);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid MCP_HTTP_PORT: ${process.env.MCP_HTTP_PORT}`);
    }

    await startHttpServer({ host, port, authToken, config });
    return;
  }

  const server = createServer(config);
  const stdio = new StdioServerTransport();
  await server.connect(stdio);

  // Never write to stdout — it is the JSON-RPC channel. Diagnostics go to stderr.
  process.stderr.write("canvas-scholar-mcp: connected over stdio\n");
}

main().catch((err) => {
  process.stderr.write(`canvas-scholar-mcp: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
