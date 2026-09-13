import { describe, it, expect, vi, afterEach } from "vitest";
import type { CanvasClient } from "../src/lib/canvas-client.js";
import * as canvas from "../src/tools/canvas-tools.js";

function mockClient(
  overrides: Partial<Record<"get" | "getPaginated" | "post" | "put", unknown>> = {},
) {
  const get = vi.fn().mockResolvedValue({ id: 999 });
  const getPaginated = vi.fn().mockResolvedValue([]);
  const post = vi.fn().mockResolvedValue({ id: 1 });
  const put = vi.fn().mockResolvedValue({ id: 1 });
  return Object.assign(
    { get, getPaginated, post, put } as unknown as CanvasClient & {
      get: ReturnType<typeof vi.fn>;
      getPaginated: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
    },
    overrides,
  );
}

/**
 * WRITE-SAFETY REGRESSION GUARD, mirrors tests/privacy.test.ts's role for
 * reads: contextCode must be checked against the caller's own courses/groups
 * before a calendar write is issued, or a prompt-injected contextCode from
 * untrusted Canvas content could steer a write at a course/group the caller
 * doesn't belong to.
 */
describe("calendar writes only ever target the caller's own context", () => {
  it("createCalendarEvent allows a course the user is enrolled in", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]) });
    await canvas.createCalendarEvent(c, { contextCode: "course_5", title: "Office hours" });
    expect(c.post).toHaveBeenCalledWith(
      "/calendar_events",
      expect.objectContaining({
        calendar_event: expect.objectContaining({
          context_code: "course_5",
          title: "Office hours",
        }),
      }),
    );
  });

  it("createCalendarEvent rejects a course the user is NOT enrolled in", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]) });
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "course_999", title: "x" }),
    ).rejects.toThrow(/not one of your enrolled courses/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("createCalendarEvent rejects a group the user does NOT belong to", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 3 }]) });
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "group_777", title: "x" }),
    ).rejects.toThrow(/not one of your groups/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("createCalendarEvent rejects a user_id that isn't the caller's own", async () => {
    const c = mockClient({ get: vi.fn().mockResolvedValue({ id: 42 }) });
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "user_1", title: "x" }),
    ).rejects.toThrow(/not your own user id/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("rejects a malformed contextCode before any network call", async () => {
    const c = mockClient();
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "course_abc", title: "x" }),
    ).rejects.toThrow(/Invalid contextCode/);
    expect(c.get).not.toHaveBeenCalled();
    expect(c.getPaginated).not.toHaveBeenCalled();
    expect(c.post).not.toHaveBeenCalled();
  });

  it("updateCalendarEvent re-checks contextCode when one is given, skips the check otherwise", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]) });
    await canvas.updateCalendarEvent(c, { eventId: 1, contextCode: "course_5", title: "New" });
    expect(c.put).toHaveBeenCalledWith(
      "/calendar_events/1",
      expect.objectContaining({
        calendar_event: expect.objectContaining({ context_code: "course_5" }),
      }),
    );

    const c2 = mockClient();
    await canvas.updateCalendarEvent(c2, { eventId: 1, title: "New title only" });
    expect(c2.getPaginated).not.toHaveBeenCalled();
    expect(c2.put).toHaveBeenCalledWith(
      "/calendar_events/1",
      expect.objectContaining({
        calendar_event: expect.not.objectContaining({ context_code: expect.anything() }),
      }),
    );
  });
});

describe("group discussions", () => {
  it("listGroupDiscussions hits the group-scoped endpoint", async () => {
    const c = mockClient();
    await canvas.listGroupDiscussions(c, { groupId: 12 });
    expect(c.getPaginated).toHaveBeenCalledWith("/groups/12/discussion_topics", {});
  });

  it("getGroupDiscussionView returns the view as-is when ready", async () => {
    const c = mockClient({ get: vi.fn().mockResolvedValue({ id: 1, view: [] }) });
    const res = (await canvas.getGroupDiscussionView(c, {
      groupId: 12,
      topicId: 9,
    })) as { id?: number };
    expect(res.id).toBe(1);
    expect(c.get).toHaveBeenCalledWith("/groups/12/discussion_topics/9/view");
  });

  it("getGroupDiscussionView surfaces an in-progress note instead of a half-ready view", async () => {
    const c = mockClient({ get: vi.fn().mockResolvedValue({ status: "in_progress" }) });
    const res = (await canvas.getGroupDiscussionView(c, {
      groupId: 12,
      topicId: 9,
    })) as { available?: boolean };
    expect(res.available).toBe(false);
  });
});

describe("classic quizzes degrade gracefully (empty vs. disabled are distinguishable)", () => {
  it("a genuinely empty course still returns a real []", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([]) });
    const res = await canvas.listQuizzes(c, { courseId: 1 });
    expect(res).toEqual([]);
  });

  it("a 404 (feature disabled / wrong course id) degrades to a note, not a throw", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockRejectedValue(new Error("Canvas API 404 Not Found")),
    });
    const res = (await canvas.listQuizzes(c, { courseId: 1 })) as { available?: boolean };
    expect(res.available).toBe(false);
  });
});

describe("getFile — safe content fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns metadata only for a large file (no fetch attempted)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = mockClient({
      get: vi.fn().mockResolvedValue({
        url: "https://cdn.example/f",
        size: 10_000_000,
        "content-type": "text/plain",
      }),
    });
    const res = (await canvas.getFile(c, { fileId: 1 })) as { content?: string };
    expect(res.content).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns metadata only for a binary file (no fetch attempted)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = mockClient({
      get: vi.fn().mockResolvedValue({
        url: "https://cdn.example/f",
        size: 100,
        "content-type": "application/pdf",
      }),
    });
    const res = (await canvas.getFile(c, { fileId: 1 })) as { content?: string };
    expect(res.content).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches small text content WITHOUT attaching any auth header", async () => {
    const body = "hello world";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": String(body.length) }),
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: new TextEncoder().encode(body) };
            },
          };
        },
      },
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = mockClient({
      get: vi.fn().mockResolvedValue({
        url: "https://cdn.example/f",
        size: body.length,
        "content-type": "text/plain",
      }),
    });
    const res = (await canvas.getFile(c, { fileId: 1 })) as { content?: string };
    expect(res.content).toBe(body);
    // The load-bearing assertion — the fetch to the signed CDN url must never
    // carry the Canvas bearer token (it isn't CanvasClient's fetch at all).
    expect(fetchSpy).toHaveBeenCalledWith("https://cdn.example/f");
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs.length === 1 || callArgs[1]?.headers == null).toBe(true);
  });

  it("aborts mid-stream if the real byte count exceeds the cap despite a small reported size", async () => {
    const big = "x".repeat(60_000); // over the 50_000-byte cap
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(), // no content-length — forces the streaming cap to do the work
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: new TextEncoder().encode(big) };
            },
            cancel: async () => {},
          };
        },
      },
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = mockClient({
      get: vi.fn().mockResolvedValue({
        url: "https://cdn.example/f",
        size: 100, // stale/wrong metadata size — must not be trusted alone
        "content-type": "text/plain",
      }),
    });
    const res = (await canvas.getFile(c, { fileId: 1 })) as { content?: string };
    expect(res.content).toBeUndefined();
  });
});
