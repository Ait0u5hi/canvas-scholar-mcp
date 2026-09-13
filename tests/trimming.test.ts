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

/**
 * TOKEN-BUDGET REGRESSION GUARD — a course-scoped list is naturally bounded
 * by course size, so the fix is per-row field trimming, not a row-count cap
 * (which would risk silently hiding a real assignment/discussion).
 */
describe("listAssignments trims per-row bloat", () => {
  it("drops secure_params (LTI JWT, irrelevant to a read tool)", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([
        { id: 1, name: "HW1", secure_params: "eyJ...verylongjwt..." },
      ]),
    });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0]).not.toHaveProperty("secure_params");
    expect(res[0].name).toBe("HW1");
  });

  it("truncates a large description instead of dropping it", async () => {
    const longHtml = `<p>${"x".repeat(5000)}</p>`;
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, description: longHtml }]),
    });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<{
      description?: string;
    }>;
    expect(res[0].description!.length).toBeLessThan(longHtml.length);
    expect(res[0].description!.endsWith("… [truncated]")).toBe(true);
  });

  it("leaves everything else (submission, score_statistics, due dates) untouched", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([
        { id: 1, due_at: "2026-10-01", submission: { workflow_state: "graded" } },
      ]),
    });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0].due_at).toBe("2026-10-01");
    expect(res[0].submission).toEqual({ workflow_state: "graded" });
  });
});

describe("discussion topic lists truncate the message body", () => {
  it("listDiscussions truncates a long topic message", async () => {
    const longHtml = `<p>${"y".repeat(2000)}</p>`;
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, message: longHtml }]),
    });
    const res = (await canvas.listDiscussions(c, { courseId: 1 })) as Array<{
      message?: string;
    }>;
    expect(res[0].message!.length).toBeLessThan(longHtml.length);
  });

  it("listGroupDiscussions truncates the same way", async () => {
    const longHtml = `<p>${"z".repeat(2000)}</p>`;
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, message: longHtml }]),
    });
    const res = (await canvas.listGroupDiscussions(c, { groupId: 1 })) as Array<{
      message?: string;
    }>;
    expect(res[0].message!.length).toBeLessThan(longHtml.length);
  });

  it("passes group_category_id/group_topic_children through unchanged", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([
        { id: 1, group_category_id: 5, group_topic_children: [{ id: 2, group_id: 9 }] },
      ]),
    });
    const res = (await canvas.listDiscussions(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0].group_category_id).toBe(5);
    expect(res[0].group_topic_children).toEqual([{ id: 2, group_id: 9 }]);
  });

  it("leaves a topic with no message field alone", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, title: "No body" }]),
    });
    const res = (await canvas.listDiscussions(c, { courseId: 1 })) as Array<
      Record<string, unknown>
    >;
    expect(res[0]).toEqual({ id: 1, title: "No body" });
  });
});

describe("listCourseFiles degrades gracefully when restricted", () => {
  it("returns files normally when readable", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockResolvedValue([{ id: 1, filename: "syllabus.pdf" }]),
    });
    const res = await canvas.listCourseFiles(c, { courseId: 1 });
    expect(res).toEqual([{ id: 1, filename: "syllabus.pdf" }]);
  });

  it("returns a note (not an error) on 403", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockRejectedValue(new Error("Canvas API 403 Forbidden")),
    });
    const res = (await canvas.listCourseFiles(c, { courseId: 1 })) as {
      available?: boolean;
    };
    expect(res.available).toBe(false);
  });

  it("rethrows non-403 errors", async () => {
    const c = mockClient({
      getPaginated: vi.fn().mockRejectedValue(new Error("Canvas API 500 Server Error")),
    });
    await expect(canvas.listCourseFiles(c, { courseId: 1 })).rejects.toThrow(/500/);
  });
});
