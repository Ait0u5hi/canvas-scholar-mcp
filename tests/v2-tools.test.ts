import { describe, it, expect, vi } from "vitest";
import type { CanvasClient } from "../src/lib/canvas-client.js";
import * as canvas from "../src/tools/canvas-tools.js";

function mockClient(overrides: Partial<Record<"get" | "getPaginated", unknown>> = {}) {
  const get = vi.fn().mockResolvedValue({ ok: true });
  const getPaginated = vi.fn().mockResolvedValue([]);
  return Object.assign(
    { get, getPaginated } as unknown as CanvasClient & {
      get: ReturnType<typeof vi.fn>;
      getPaginated: ReturnType<typeof vi.fn>;
    },
    overrides,
  );
}

describe("inbox is genuinely read-only", () => {
  it("getConversation forces auto_mark_as_read=false (never mutates state)", async () => {
    const c = mockClient();
    await canvas.getConversation(c, { conversationId: 42 });
    expect(c.get).toHaveBeenCalledWith("/conversations/42", {
      auto_mark_as_read: false,
    });
  });
});

describe("calendar context_codes derivation + chunking", () => {
  it("chunks >10 course ids into calls of at most 10 context_codes", async () => {
    const c = mockClient();
    const ids = Array.from({ length: 23 }, (_, i) => i + 1);
    await canvas.listCalendarEvents(c, { courseIds: ids });

    // 23 ids → 10 + 10 + 3 → three calendar calls, none over 10 contexts.
    const calls = c.getPaginated.mock.calls.filter(
      ([path]) => path === "/calendar_events",
    );
    expect(calls).toHaveLength(3);
    for (const [, params] of calls) {
      expect((params.context_codes as string[]).length).toBeLessThanOrEqual(10);
      expect(params.context_codes[0]).toMatch(/^course_\d+$/);
    }
  });

  it("derives course ids from list_courses when none are given", async () => {
    const c = mockClient({
      getPaginated: vi
        .fn()
        // first call = /courses, second = /calendar_events
        .mockResolvedValueOnce([{ id: 7 }, { id: 8 }])
        .mockResolvedValue([]),
    });
    await canvas.listCalendarEvents(c);
    const paths = c.getPaginated.mock.calls.map(([p]) => p);
    expect(paths).toContain("/courses");
    expect(paths).toContain("/calendar_events");
  });
});

describe("roster degrades gracefully when hidden", () => {
  it("returns a restricted note (not an error) on 403", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden")),
    });
    const res = (await canvas.listCoursePeople(c, { courseId: 1 })) as {
      restricted?: boolean;
    };
    expect(res.restricted).toBe(true);
  });

  it("rethrows non-403 errors", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockRejectedValue(new Error("Canvas API 500 Server Error")),
    });
    await expect(canvas.listCoursePeople(c, { courseId: 1 })).rejects.toThrow(/500/);
  });
});

describe("conferences (the BigBlueButton gap)", () => {
  it("uses the cross-course endpoint by default and honors state=live", async () => {
    const c = mockClient();
    await canvas.listConferences(c, { state: "live" });
    expect(c.getPaginated).toHaveBeenCalledWith("/conferences", { state: "live" });
  });

  it("uses the per-course endpoint when a courseId is given", async () => {
    const c = mockClient();
    await canvas.listConferences(c, { courseId: 42 });
    expect(c.getPaginated).toHaveBeenCalledWith("/courses/42/conferences", {});
  });
});

describe("endpoint correctness for new tools", () => {
  it("submission feedback hits submissions/self with comments+rubric includes", async () => {
    const c = mockClient();
    await canvas.getSubmissionFeedback(c, { courseId: 1, assignmentId: 2 });
    const [path, params] = c.get.mock.calls[0];
    expect(path).toBe("/courses/1/assignments/2/submissions/self");
    expect(params.include).toEqual(
      expect.arrayContaining(["submission_comments", "rubric_assessment"]),
    );
  });

  it("announcements sends the required context_codes", async () => {
    const c = mockClient();
    await canvas.listAnnouncements(c, { courseId: 5 });
    const [path, params] = c.getPaginated.mock.calls[0];
    expect(path).toBe("/announcements");
    expect(params.context_codes).toEqual(["course_5"]);
  });

  it("my groups reads /users/self/groups", async () => {
    const c = mockClient();
    await canvas.listMyGroups(c);
    expect(c.getPaginated).toHaveBeenCalledWith("/users/self/groups", {});
  });

  it("classic quiz submission is self-scoped", async () => {
    const c = mockClient();
    await canvas.getMyQuizSubmission(c, { courseId: 1, quizId: 9 });
    expect(c.get).toHaveBeenCalledWith("/courses/1/quizzes/9/submission");
  });
});

describe("peer reviews filter to just mine by default", () => {
  it("keeps only reviews where I am the assessor", async () => {
    const c = mockClient({
      get: vi.fn().mockResolvedValue({ id: 100 }),
      getPaginated: vi
        .fn()
        .mockResolvedValue([{ assessor_id: 100 }, { assessor_id: 200 }, { assessor_id: 100 }]),
    });
    const res = (await canvas.listPeerReviews(c, {
      courseId: 1,
      assignmentId: 2,
    })) as Array<{ assessor_id: number }>;
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.assessor_id === 100)).toBe(true);
    expect(c.get).toHaveBeenCalledWith("/users/self");
  });

  it("returns everyone when mineOnly is false (no self lookup)", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ assessor_id: 1 }, { assessor_id: 2 }]),
    });
    const res = (await canvas.listPeerReviews(c, {
      courseId: 1,
      assignmentId: 2,
      mineOnly: false,
    })) as unknown[];
    expect(res).toHaveLength(2);
    expect(c.get).not.toHaveBeenCalled();
  });
});

describe("late policy degrades if instructor-only", () => {
  it("returns the policy when readable", async () => {
    const c = mockClient({
      get: vi.fn().mockResolvedValue({ late_submission_deduction: 10 }),
    });
    await canvas.getLatePolicy(c, { courseId: 1 });
    expect(c.get).toHaveBeenCalledWith("/courses/1/late_policy");
  });

  it("returns a note (not an error) on 403", async () => {
    const c = mockClient({
      get: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden")),
    });
    const res = (await canvas.getLatePolicy(c, { courseId: 1 })) as {
      available?: boolean;
    };
    expect(res.available).toBe(false);
  });
});

describe("beta/permissioned endpoints degrade gracefully", () => {
  it("smart search hits the endpoint with q, notes-out when unavailable", async () => {
    const ok = mockClient({ get: vi.fn().mockResolvedValue({ results: [] }) });
    await canvas.smartSearch(ok, { courseId: 1, query: "skewness" });
    expect(ok.get).toHaveBeenCalledWith("/courses/1/smartsearch", { q: "skewness" });

    const beta = mockClient({
      get: vi.fn().mockRejectedValue(new Error("Canvas API 404 Not Found")),
    });
    const res = (await canvas.smartSearch(beta, { courseId: 1, query: "x" })) as {
      available?: boolean;
    };
    expect(res.available).toBe(false);
  });

  it("grading standards notes-out on 403", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden")),
    });
    const res = (await canvas.getGradingStandards(c, { courseId: 1 })) as {
      available?: boolean;
    };
    expect(res.available).toBe(false);
  });
});

describe("HTML summarization", () => {
  it("strips tags, collapses whitespace, and truncates", () => {
    expect(canvas.summarizeHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(canvas.summarizeHtml(undefined)).toBe("");
    const long = canvas.summarizeHtml("<p>" + "x".repeat(5000) + "</p>", 100);
    expect(long.endsWith("… [truncated]")).toBe(true);
    expect(long.length).toBeLessThan(200);
  });

  it("drops script/style content entirely", () => {
    const out = canvas.summarizeHtml("<style>.a{}</style><p>keep</p><script>bad()</script>");
    expect(out).toBe("keep");
  });
});
