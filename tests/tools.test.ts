import { describe, it, expect, vi } from "vitest";
import type { CanvasClient } from "../src/lib/canvas-client.js";
import * as canvas from "../src/tools/canvas-tools.js";

function mockClient() {
  const get = vi.fn().mockResolvedValue({ ok: true });
  const getPaginated = vi.fn().mockResolvedValue([]);
  return { get, getPaginated } as unknown as CanvasClient & {
    get: ReturnType<typeof vi.fn>;
    getPaginated: ReturnType<typeof vi.fn>;
  };
}

describe("endpoint correctness", () => {
  it("getGrades uses the enrollments endpoint (not the non-existent /users/self/grades)", async () => {
    const c = mockClient();
    await canvas.getGrades(c);
    expect(c.getPaginated).toHaveBeenCalledWith(
      "/users/self/enrollments",
      expect.objectContaining({ include: ["grades"] }),
    );
  });

  it("getDiscussionView calls the /view sub-resource for reply bodies", async () => {
    const c = mockClient();
    await canvas.getDiscussionView(c, { courseId: 1, topicId: 2 });
    expect(c.get).toHaveBeenCalledWith("/courses/1/discussion_topics/2/view");
  });

  it("getMissingSubmissions reads /users/self/missing_submissions", async () => {
    const c = mockClient();
    await canvas.getMissingSubmissions(c);
    expect(c.getPaginated).toHaveBeenCalledWith(
      "/users/self/missing_submissions",
      expect.any(Object),
    );
  });

  it("getActivityStream reads /users/self/activity_stream", async () => {
    const c = mockClient();
    await canvas.getActivityStream(c);
    expect(c.getPaginated).toHaveBeenCalledWith(
      "/users/self/activity_stream",
      expect.any(Object),
    );
  });
});

describe("planner date scoping", () => {
  it("always sends a bounded start_date and end_date, even with no args", async () => {
    const c = mockClient();
    await canvas.getPlannerItems(c);
    const [path, params] = c.getPaginated.mock.calls[0];
    expect(path).toBe("/planner/items");
    expect(params.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes through explicit dates", async () => {
    const c = mockClient();
    await canvas.getPlannerItems(c, {
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const [, params] = c.getPaginated.mock.calls[0];
    expect(params).toMatchObject({
      start_date: "2026-08-01",
      end_date: "2026-08-31",
    });
  });
});
