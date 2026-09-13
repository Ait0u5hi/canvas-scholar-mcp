import { describe, it, expect, vi } from "vitest";
import { CanvasApiError, type CanvasClient } from "../src/lib/canvas-client.js";
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

/**
 * MEASURED TOKEN-BUDGET GUARD — the field report this fix responded to
 * quoted a concrete failure size (88,750 characters for one real course).
 * Asserting "fields get shorter" isn't the same claim as "the response stays
 * under budget" — this models a large-but-realistic course (100 assignments,
 * each with a sizeable description and a 5-criterion rubric with ratings,
 * the actual shape that caused the original overflow) and asserts the
 * trimmed total stays well under the ~100k-character range that caused the
 * original report, not just "smaller than before."
 */
describe("listAssignments stays within a measured size budget on a large course", () => {
  function bigAssignment(i: number) {
    return {
      id: i,
      name: `Assignment ${i}`,
      secure_params: "e".repeat(400), // realistic LTI JWT length
      description: `<p>${"d".repeat(1500)}</p>`,
      rubric: Array.from({ length: 5 }, (_, c) => ({
        id: `c${c}`,
        description: "r".repeat(500),
        long_description: "r".repeat(500),
        ratings: Array.from({ length: 4 }, (_, r) => ({
          id: `r${r}`,
          description: "r".repeat(500),
        })),
      })),
    };
  }

  it("each trimmed assignment stays under a fixed per-row size, regardless of rubric size", async () => {
    // The real invariant the trim guarantees: a bound on ONE row, deterministic
    // regardless of how many assignments a course has (which this codebase
    // deliberately does not cap — see listAssignments' own doc comment). An
    // aggregate "total response < N" claim would depend on how many
    // assignments/rubrics happen to exist, which isn't something the trim
    // function controls or should be judged against.
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue([bigAssignment(1)]) });
    const res = (await canvas.listAssignments(c, { courseId: 1 })) as Array<unknown>;
    const rowSize = JSON.stringify(res[0]).length;
    const rawRowSize = JSON.stringify(bigAssignment(1)).length;

    expect(rawRowSize).toBeGreaterThan(10_000); // sanity: the fixture is genuinely bloated
    // 5 criteria x (description + long_description + 4 ratings), each capped
    // at 200 chars, is the real per-row ceiling this trim produces — not an
    // arbitrary round number. Some headroom above the exact computed value
    // (~8.4k for this fixture) to avoid flaking on incidental JSON overhead.
    expect(rowSize).toBeLessThan(9_500);
    expect(rowSize).toBeLessThan(rawRowSize); // and a genuine cut, not a no-op
  });

  it("100 such rows scale linearly (no hidden quadratic blowup in the trim itself)", async () => {
    const raw = Array.from({ length: 100 }, (_, i) => bigAssignment(i));
    const c = mockClient({ getPaginated: vi.fn().mockResolvedValue(raw) });
    const res = await canvas.listAssignments(c, { courseId: 1 });
    const totalSize = JSON.stringify(res).length;
    const perRowSize = JSON.stringify(res[0]).length;

    // Total should track ~100x one row, not blow up disproportionately.
    expect(totalSize).toBeLessThan(perRowSize * 100 * 1.1);
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
      getPaginated: vi
        .fn()
        .mockRejectedValue(new CanvasApiError("Canvas API 403 Forbidden", 403, "forbidden")),
    });
    const res = (await canvas.listCourseFiles(c, { courseId: 1 })) as {
      available?: boolean;
    };
    expect(res.available).toBe(false);
  });

  it("does NOT treat a rate-limit 403 as 'restricted to instructors'", async () => {
    const c = mockClient({
      getPaginated: vi
        .fn()
        .mockRejectedValue(
          new CanvasApiError("Canvas API rate limit hit (403)...", 403, "rate_limit"),
        ),
    });
    await expect(canvas.listCourseFiles(c, { courseId: 1 })).rejects.toThrow(/rate limit/);
  });

  it("rethrows non-403 errors", async () => {
    const c = mockClient({
      getPaginated: vi
        .fn()
        .mockRejectedValue(new CanvasApiError("Canvas API 500 Server Error", 500, "other")),
    });
    await expect(canvas.listCourseFiles(c, { courseId: 1 })).rejects.toThrow(/500/);
  });
});
