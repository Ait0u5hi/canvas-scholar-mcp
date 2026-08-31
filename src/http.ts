/**
 * Optional LAN / remote HTTP transport for canvas-scholar-mcp.
 *
 * The default transport is stdio (spawned locally by a trusted client). This
 * module adds an opt-in HTTP endpoint so one always-on instance can serve many
 * MCP clients over a network — enabled with MCP_TRANSPORT=http.
 *
 * Auth is a **static bearer token** (MCP_AUTH_TOKEN), checked on every request.
 * This is a deliberate, documented deviation from the MCP HTTP-auth spec (which
 * is OPTIONAL and recommends full OAuth 2.1 with an authorization server) — an
 * API-key pattern is proportionate for a single-user LAN deployment. We still
 * reuse the SDK's bearer-auth middleware so the 401 / WWW-Authenticate handling
 * is spec-shaped. For anything beyond a trusted LAN, front this with TLS (e.g.
 * a Caddy reverse proxy) and consider real OAuth 2.1.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CanvasConfig } from "./lib/config.js";
import { createServer } from "./server.js";

export interface HttpOptions {
  host: string;
  port: number;
  /** The bearer token clients must present (server access, not the Canvas token). */
  authToken: string;
  config: CanvasConfig;
}

/**
 * A minimal OAuthTokenVerifier that accepts exactly one static token. The SDK's
 * requireBearerAuth middleware calls verifyAccessToken and turns a thrown
 * InvalidTokenError into a 401 with a WWW-Authenticate header. It also requires
 * a numeric future `expiresAt`, so we hand back a short rolling window.
 */
export function staticTokenVerifier(expected: string): OAuthTokenVerifier {
  const expectedBuf = Buffer.from(expected);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const presented = Buffer.from(token);
      const matches =
        presented.length === expectedBuf.length &&
        timingSafeEqual(presented, expectedBuf);
      if (!matches) {
        throw new InvalidTokenError("Invalid bearer token");
      }
      return {
        token,
        clientId: "canvas-scholar-lan",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    },
  };
}

const jsonRpcError = (message: string, code = -32000) => ({
  jsonrpc: "2.0" as const,
  error: { code, message },
  id: null,
});

/**
 * Build the Express app for the HTTP transport. Exposed separately from
 * startHttpServer so tests can drive it without binding a fixed port.
 *
 * Stateful sessions: an `initialize` request mints a session (Mcp-Session-Id
 * header); subsequent requests reuse the transport for that session. Each
 * session gets its own McpServer instance. JSON responses are enabled so plain
 * HTTP clients (and curl) get a JSON body rather than an SSE stream.
 */
export function buildHttpApp(opts: HttpOptions): express.Express {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const auth = requireBearerAuth({ verifier: staticTokenVerifier(opts.authToken) });
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", auth, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (!isInitializeRequest(req.body)) {
          res
            .status(400)
            .json(jsonRpcError("No valid session; send an initialize request first."));
          return;
        }
        const created: StreamableHTTPServerTransport =
          new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (sid) => {
              transports.set(sid, created);
            },
          });
        created.onclose = () => {
          if (created.sessionId) transports.delete(created.sessionId);
        };
        const server = createServer(opts.config);
        await server.connect(created);
        transport = created;
      }

      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError("Internal server error", -32603));
      }
    }
  });

  // GET (server->client SSE stream) and DELETE (session teardown) require an
  // established session; delegate to its transport.
  const withSession: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json(jsonRpcError("Invalid or missing session id"));
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", auth, withSession);
  app.delete("/mcp", auth, withSession);

  return app;
}

export async function startHttpServer(opts: HttpOptions): Promise<void> {
  const app = buildHttpApp(opts);
  await new Promise<void>((resolve, reject) => {
    const srv = app.listen(opts.port, opts.host, () => resolve());
    srv.on("error", reject);
  });
  process.stderr.write(
    `canvas-scholar-mcp: HTTP transport listening on http://${opts.host}:${opts.port}/mcp\n`,
  );
}
