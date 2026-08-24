import { describe, it, expect, vi } from "vitest";
import type { CanvasClient } from "../src/lib/canvas-client.js";
import { getCourseGrade, getGrades } from "../src/tools/canvas-tools.js";

/**
 * PRIVACY REGRESSION GUARD.
 *
 * The single most important behavior in this server: a student can only ever
 * read their OWN grades. `getCourseGrade` hits `/courses/:id/enrollments`,
 * which returns the whole class roster unless scoped with `user_id: "self"`.
 * If someone deletes that param, this test must go red.
 */
describe("grade scoping is student-self only", () => {
  it("getCourseGrade sends user_id: 'self'", async () => {
    const getPaginated = vi.fn().mockResolvedValue([]);
    const client = { getPaginated } as unknown as CanvasClient;

    await getCourseGrade(client, { courseId: 572343 });

    expect(getPaginated).toHaveBeenCalledTimes(1);
    const [path, params] = getPaginated.mock.calls[0];
    expect(path).toBe("/courses/572343/enrollments");
    // The load-bearing assertion — remove user_id:self upstream and this fails.
    expect(params).toMatchObject({ user_id: "self" });
  });

  it("getGrades reads only /users/self, never a course roster", async () => {
    const getPaginated = vi.fn().mockResolvedValue([]);
    const client = { getPaginated } as unknown as CanvasClient;

    await getGrades(client);

    const [path] = getPaginated.mock.calls[0];
    expect(path).toBe("/users/self/enrollments");
    expect(path).not.toMatch(/\/courses\//);
  });
});
