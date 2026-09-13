import { describe, it, expect, vi, afterEach } from "vitest";
import { CanvasApiError, CanvasClient } from "../src/lib/canvas-client.js";

function fakeRes({
  remaining,
  status = 200,
  ok = true,
  contentType = "application/json",
  body = [] as unknown,
  text = "",
}: {
  remaining?: number;
  status?: number;
  ok?: boolean;
  contentType?: string;
  body?: unknown;
  text?: string;
}) {
  const headers = new Map<string, string>([["content-type", contentType]]);
  if (remaining != null) headers.set("x-rate-limit-remaining", String(remaining));
  return {
    ok,
    status,
    statusText: "STATUS",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

function client() {
  return new CanvasClient({ token: "t", baseUrl: "https://x.instructure.com/api/v1" });
}

afterEach(() => vi.unstubAllGlobals());

describe("API usage tracking", () => {
  it("counts requests and records Canvas's remaining budget", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeRes({ remaining: 640 })));
    const c = client();
    await c.get("/courses");
    const u = c.usage();
    expect(u.requestsThisSession).toBe(1);
    expect(u.canvasQuotaRemaining).toBe(640);
    expect(u.status).toBe("ok");
  });

  it("flags 'getting low' and emits an occasional notice (not every call)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeRes({ remaining: 40 })));
    const c = client();
    await c.get("/a");
    expect(c.usage().status).toBe("getting low");
    // First check while low → a notice; immediate second check → suppressed.
    expect(c.consumeUsageNotice()).toMatch(/budget is getting low/);
    expect(c.consumeUsageNotice()).toBeNull();
  });

  it("turns a rate-limit 403 into a friendly, actionable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeRes({ ok: false, status: 403, text: "403 Forbidden (Rate Limit Exceeded)" }),
      ),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toThrow(/rate limit hit/i);
  });
});

/**
 * STRUCTURED-ERROR REGRESSION GUARD — the whole point of CanvasApiError is
 * that callers classify failures by `.status`/`.kind`, not by regexing
 * `.message`. A rate-limit 403 and a permission-denied 403 share the same
 * status but must carry different `kind`, or every downstream `isForbidden`/
 * `isPermissionIssue` check silently breaks.
 */
describe("CanvasApiError classification", () => {
  it("a rate-limit 403 carries kind='rate_limit'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 403, text: "rate limit exceeded" })),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toMatchObject(
      expect.objectContaining({ status: 403, kind: "rate_limit" }),
    );
  });

  it("a 429 also carries kind='rate_limit'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 429, text: "" })),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toMatchObject(
      expect.objectContaining({ status: 429, kind: "rate_limit" }),
    );
  });

  it("a genuine 403 (no rate-limit body) carries kind='forbidden'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 403, text: "not authorized" })),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toMatchObject(
      expect.objectContaining({ status: 403, kind: "forbidden" }),
    );
  });

  it("a 401 carries kind='unauthorized'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 401, text: "" })),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toMatchObject(
      expect.objectContaining({ status: 401, kind: "unauthorized" }),
    );
  });

  it("a 500 carries kind='other'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 500, text: "" })),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toMatchObject(
      expect.objectContaining({ status: 500, kind: "other" }),
    );
  });

  it("errors thrown are real CanvasApiError instances", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 404, text: "" })),
    );
    const c = client();
    await expect(c.get("/a")).rejects.toBeInstanceOf(CanvasApiError);
  });
});
