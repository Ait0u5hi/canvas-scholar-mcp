import { describe, it, expect, vi, afterEach } from "vitest";
import { CanvasClient } from "../src/lib/canvas-client.js";

function fakeRes({
  status = 200,
  ok = true,
  contentType = "application/json",
  body = {} as unknown,
  text = "",
}: {
  status?: number;
  ok?: boolean;
  contentType?: string;
  body?: unknown;
  text?: string;
}) {
  const headers = new Map<string, string>();
  if (contentType) headers.set("content-type", contentType);
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

describe("CanvasClient.post/put", () => {
  it("sends a JSON body with the right method and headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeRes({ body: { id: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);
    const c = client();
    const res = await c.post("/calendar_events", { calendar_event: { title: "x" } });
    expect(res).toEqual({ id: 1 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://x.instructure.com/api/v1/calendar_events");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ calendar_event: { title: "x" } });
  });

  it("put sends PUT to the given path", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeRes({ body: { id: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);
    const c = client();
    await c.put("/calendar_events/1", { calendar_event: { title: "y" } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://x.instructure.com/api/v1/calendar_events/1");
    expect(init.method).toBe("PUT");
  });

  it("handles a 204 No Content response without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ status: 204, contentType: "" })),
    );
    const c = client();
    await expect(c.put("/calendar_events/1", { calendar_event: {} })).resolves.toBeUndefined();
  });

  it("surfaces Canvas's errors[] array instead of a bare 'Bad Request'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeRes({
          ok: false,
          status: 400,
          text: JSON.stringify({
            errors: [{ message: "end_at can't be before start_at" }],
          }),
        }),
      ),
    );
    const c = client();
    await expect(
      c.post("/calendar_events", { calendar_event: {} }),
    ).rejects.toThrow(/end_at can't be before start_at/);
  });

  it("surfaces a plain message field when there's no errors[] array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeRes({ ok: false, status: 422, text: JSON.stringify({ message: "nope" }) }),
      ),
    );
    const c = client();
    await expect(c.post("/calendar_events", {})).rejects.toThrow(/nope/);
  });

  it("still works if the error body isn't JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeRes({ ok: false, status: 500, text: "<html>oops</html>" })),
    );
    const c = client();
    await expect(c.post("/calendar_events", {})).rejects.toThrow(/500/);
  });
});
