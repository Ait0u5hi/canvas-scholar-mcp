import type { CanvasClient } from "../lib/canvas-client.js";

/**
 * Read-only, student-scoped Canvas operations.
 *
 * Every function here operates as the token's own user (`/users/self/...` or an
 * explicit `user_id: "self"` filter). None of them can read another student's
 * data — see `getCourseGrade` for the load-bearing example.
 */

export interface CourseArg {
  courseId: number | string;
}

/** List the courses the current user is enrolled in (active by default). */
export function listCourses(
  client: CanvasClient,
  args: { includeConcluded?: boolean } = {},
) {
  return client.getPaginated("/courses", {
    enrollment_state: args.includeConcluded ? undefined : "active",
    include: ["term"],
  });
}

/** List assignments in a course. `bucket` can narrow to e.g. "upcoming". */
export function listAssignments(
  client: CanvasClient,
  args: CourseArg & { bucket?: string },
) {
  return client.getPaginated(`/courses/${args.courseId}/assignments`, {
    bucket: args.bucket,
    include: ["submission"],
  });
}

/** Get one assignment, including the current user's submission. */
export function getAssignment(
  client: CanvasClient,
  args: CourseArg & { assignmentId: number | string },
) {
  return client.get(
    `/courses/${args.courseId}/assignments/${args.assignmentId}`,
    { include: ["submission"] },
  );
}

/**
 * Grades across all of the current user's enrollments.
 *
 * Uses `/users/self/enrollments` with `include[]=grades` — the classic
 * `/users/self/grades` path does not exist in the Canvas API.
 */
export function getGrades(client: CanvasClient) {
  return client.getPaginated("/users/self/enrollments", {
    include: ["grades"],
    state: ["active"],
  });
}

/**
 * Grade for a single course.
 *
 * PRIVACY-CRITICAL: `user_id: "self"` MUST be present. Without it,
 * `/courses/:id/enrollments` returns the entire class roster (every student's
 * enrollment and, with include[]=grades, their grades). The unit test in
 * tests/privacy.test.ts asserts this parameter and fails if it is removed.
 */
export function getCourseGrade(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/enrollments`, {
    user_id: "self",
    include: ["grades"],
  });
}

/** List discussion topics in a course (metadata only; use getDiscussionView for replies). */
export function listDiscussions(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/discussion_topics`, {});
}

/**
 * Full threaded view of one discussion topic, including reply bodies.
 * `/discussion_topics/:id` alone returns metadata/counts, not the actual replies.
 */
export function getDiscussionView(
  client: CanvasClient,
  args: CourseArg & { topicId: number | string },
) {
  return client.get(
    `/courses/${args.courseId}/discussion_topics/${args.topicId}/view`,
  );
}

/** Assignments the current user has not submitted and are past/near due. */
export function getMissingSubmissions(
  client: CanvasClient,
  args: { courseIds?: (number | string)[] } = {},
) {
  return client.getPaginated("/users/self/missing_submissions", {
    course_ids: args.courseIds,
    include: ["planner_overrides"],
  });
}

/**
 * Planner items (assignments, quizzes, events) in a date window.
 *
 * A window is effectively required: calling `/planner/items` unscoped returns
 * the user's entire multi-year Canvas history. We default to a sane window if
 * the caller omits one.
 */
export function getPlannerItems(
  client: CanvasClient,
  args: { startDate?: string; endDate?: string } = {},
) {
  const start = args.startDate ?? isoDaysFromNow(-1);
  const end = args.endDate ?? isoDaysFromNow(14);
  return client.getPaginated("/planner/items", {
    start_date: start,
    end_date: end,
  });
}

/** The current user's recent activity stream (announcements, messages, etc.). */
export function getActivityStream(client: CanvasClient) {
  return client.getPaginated("/users/self/activity_stream", {});
}

/** List modules in a course, with their items. */
export function listModules(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/modules`, {
    include: ["items"],
  });
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
