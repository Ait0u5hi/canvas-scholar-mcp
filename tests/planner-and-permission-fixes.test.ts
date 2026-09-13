import { describe, it, expect, vi } from "vitest";
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
 * RUBRIC REGRESSION GUARD — a rubric-restricted course makes the embedded
 * `rubric` on the assignment object the *only* student-readable copy, so it
 * must be truncated, never dropped (unlike secure_params, which is always
 * safe to drop outright).
 */
describe("listAssignments truncates rubric instead of dropping it", () => {
  it("keeps rubric present but shrinks long criterion/rating text", async () => {
    const longText = "x".repeat(2000);
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([
        {
          id: 1,
          rubric: [
            {
              id: "c1",
              description: longText,
              long_description: longText,
              ratings: [{ id: "r1", description: longText }],
            },
          ],
        },
      ]),
    });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<{
      rubric?: Array<{
        description?: string;
        long_description?: string;
        ratings?: Array<{ description?: string }>;
      }>;
    }>;
    const criterion = res[0].rubric![0];
    expect(criterion.description).toBeDefined();
    expect(criterion.description!.length).toBeLessThan(longText.length);
    expect(criterion.long_description!.length).toBeLessThan(longText.length);
    expect(criterion.ratings![0].description!.length).toBeLessThan(longText.length);
  });

  it("still strips secure_params", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, secure_params: "jwt..." }]),
    });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0]).not.toHaveProperty("secure_params");
  });

  it("leaves an assignment with no rubric attached alone", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, name: "No rubric here" }]),
    });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0]).toEqual({ id: 1, name: "No rubric here" });
  });
});

describe("the same trim now applies to listNewQuizzes and getAssignmentGroups", () => {
  it("listNewQuizzes strips secure_params from its assignment shells", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, secure_params: "jwt..." }]),
    });
    const res = (await canvas.listNewQuizzes(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0]).not.toHaveProperty("secure_params");
  });

  it("getAssignmentGroups trims each group's nested assignments", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([
        {
          id: 10,
          name: "Homework",
          assignments: [{ id: 1, secure_params: "jwt..." }],
        },
      ]),
    });
    const res = (await canvas.getAssignmentGroups(c, { courseId: 1 })) as Array<{
      assignments?: Array<Record<string, unknown>>;
    }>;
    expect(res[0].assignments![0]).not.toHaveProperty("secure_params");
  });

  it("getAssignment drops secure_params but keeps full rubric detail", async () => {
    const longText = "y".repeat(2000);
    const c = mockClient({
      get: vi.fn().mockResolvedValue({
        id: 1,
        secure_params: "jwt...",
        rubric: [{ id: "c1", description: longText }],
      }),
    });
    const res = (await canvas.getAssignment(c, { courseId: 1, assignmentId: 2 })) as {
      secure_params?: string;
      rubric?: Array<{ description: string }>;
    };
    expect(res.secure_params).toBeUndefined();
    expect(res.rubric![0].description).toBe(longText);
  });
});

/**
 * PERMISSION-HINT REGRESSION GUARD — the hint must only fire on a genuine
 * permission-denied 403, never on a rate-limit 403 that happens to contain
 * the same substring "403".
 */
describe("calendar write permission hint", () => {
  it("adds the hint on a genuine course-context permission denial", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]),
      post: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden for ...")),
    });
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "course_5", title: "x" }),
    ).rejects.toThrow(/students typically lack calendar-write permission/);
  });

  it("does NOT add the hint on a rate-limit 403 (same literal substring '403')", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]),
      post: vi
        .fn()
        .mockRejectedValue(
          new Error("Canvas API rate limit hit (403). Your request budget is temporarily exhausted"),
        ),
    });
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "course_5", title: "x" }),
    ).rejects.not.toThrow(/students typically lack calendar-write permission/);
  });

  it("does NOT add the hint on a user-context write (only course/group qualify)", async () => {
    const c = mockClient({
      get: vi.fn().mockResolvedValue({ id: 42 }),
      post: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden for ...")),
    });
    await expect(
      canvas.createCalendarEvent(c, { contextCode: "user_42", title: "x" }),
    ).rejects.not.toThrow(/students typically lack calendar-write permission/);
  });

  it("updateCalendarEvent gets the same hint when a contextCode is passed", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]),
      put: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden for ...")),
    });
    await expect(
      canvas.updateCalendarEvent(c, { eventId: 1, contextCode: "course_5", title: "x" }),
    ).rejects.toThrow(/students typically lack calendar-write permission/);
  });
});

describe("planner_notes write tools", () => {
  it("createPlannerNote posts the right body shape", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]) });
    await canvas.createPlannerNote(c, {
      courseId: 5,
      title: "Study for exam",
      details: "ch 1-3",
      todoDate: "2026-10-01",
    });
    expect(c.post).toHaveBeenCalledWith("/planner_notes", {
      title: "Study for exam",
      details: "ch 1-3",
      todo_date: "2026-10-01",
      course_id: 5,
    });
  });

  it("createPlannerNote rejects a course the caller doesn't belong to", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]) });
    await expect(
      canvas.createPlannerNote(c, { courseId: 999, todoDate: "2026-10-01" }),
    ).rejects.toThrow(/not one of your enrolled courses/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("createPlannerNote works with no courseId at all (pure personal to-do)", async () => {
    const c = mockClient();
    await canvas.createPlannerNote(c, { title: "Buy textbook", todoDate: "2026-10-01" });
    expect(c.getPaginated).not.toHaveBeenCalled();
    expect(c.post).toHaveBeenCalledWith("/planner_notes", {
      title: "Buy textbook",
      details: undefined,
      todo_date: "2026-10-01",
      course_id: undefined,
    });
  });

  it("updatePlannerNote puts to the right path and re-checks a passed courseId", async () => {
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([{ id: 5 }]) });
    await canvas.updatePlannerNote(c, { noteId: 7, courseId: 5, title: "Updated" });
    expect(c.put).toHaveBeenCalledWith("/planner_notes/7", {
      title: "Updated",
      details: undefined,
      todo_date: undefined,
      course_id: 5,
    });
  });

  it("updatePlannerNote skips the course check when no courseId is passed", async () => {
    const c = mockClient();
    await canvas.updatePlannerNote(c, { noteId: 7, title: "Updated" });
    expect(c.getPaginated).not.toHaveBeenCalled();
  });
});
