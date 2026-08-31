import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { buildHttpApp } from "../src/http.js";

const TOKEN = "test-bearer-token";
const app = buildHttpApp({
  host: "127.0.0.1",
  port: 0,
  authToken: TOKEN,
  // initialize never touches Canvas, so a dummy config is enough here.
  config: { token: "unused", baseUrl: "https://example.instructure.com/api/v1" },
});

let server: Server;
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const initBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
  },
};

const post = (headers: Record<string, string>, body: unknown) =>
  fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("http transport bearer auth", () => {
  it("rejects a request with no Authorization header (401)", async () => {
    const res = await post({}, initBody);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("rejects a wrong bearer token (401)", async () => {
    const res = await post({ Authorization: "Bearer wrong-token" }, initBody);
    expect(res.status).toBe(401);
  });

  it("rejects a malformed Authorization header (401)", async () => {
    const res = await post({ Authorization: TOKEN }, initBody);
    expect(res.status).toBe(401);
  });

  it("accepts the correct bearer token and initializes (200 + session id)", async () => {
    const res = await post({ Authorization: `Bearer ${TOKEN}` }, initBody);
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const json = (await res.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(json.result?.serverInfo?.name).toBe("canvas-scholar-mcp");
  });

  it("passes auth but requires a session for non-initialize requests (400)", async () => {
    const res = await post(
      { Authorization: `Bearer ${TOKEN}` },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    );
    expect(res.status).toBe(400);
  });
});
