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
 *
 * Canvas quirk (do not "fix"): in a course with nothing graded yet you may see
 * `grades.final_score: 0` while `grades.current_score: null`. That is Canvas's
 * own behavior — `current_score` ignores ungraded work, `final_score` treats it
 * as 0 — not a bug in this tool. We pass the grades object through verbatim.
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

// ---------------------------------------------------------------------------
// v0.2 — broader student-readable surface. All read-only, all self-scoped.
// ---------------------------------------------------------------------------

/* ---- Grades / feedback ---- */

/**
 * Your submission for one assignment, including the professor's comments, the
 * rubric assessment, and your attempt history. `self` reads only your own
 * submission — no special permission needed.
 */
export function getSubmissionFeedback(
  client: CanvasClient,
  args: CourseArg & { assignmentId: number | string },
) {
  return client.get(
    `/courses/${args.courseId}/assignments/${args.assignmentId}/submissions/self`,
    {
      include: [
        "submission_comments",
        "rubric_assessment",
        "full_rubric_assessment",
        "submission_history",
      ],
    },
  );
}

/**
 * Assignment groups with their weights and your submissions — lets you see the
 * weighted breakdown behind a course grade. Note: Canvas returns drop rules
 * (drop_lowest/highest) but does NOT pre-apply them; interpret client-side.
 */
export function getAssignmentGroups(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/assignment_groups`, {
    include: ["assignments", "submission"],
  });
}

/** Announcements for a course (students only ever see active ones). */
export function listAnnouncements(client: CanvasClient, args: CourseArg) {
  // `context_codes[]` is required by the announcements endpoint.
  return client.getPaginated("/announcements", {
    context_codes: [`course_${args.courseId}`],
    active_only: true,
  });
}

/** A course's instructor-authored syllabus (HTML, truncated for readability). */
export async function getSyllabus(client: CanvasClient, args: CourseArg) {
  const course = (await client.get(`/courses/${args.courseId}`, {
    include: ["syllabus_body"],
  })) as { syllabus_body?: string; name?: string; id?: number };
  return {
    course_id: course.id,
    name: course.name,
    syllabus: summarizeHtml(course.syllabus_body),
  };
}

/* ---- Files ---- */

/** List files in a course (locked/hidden folders are silently excluded). */
export function listCourseFiles(
  client: CanvasClient,
  args: CourseArg & { searchTerm?: string },
) {
  return client.getPaginated(`/courses/${args.courseId}/files`, {
    search_term: args.searchTerm,
  });
}

/**
 * File metadata. The returned `url` field is itself a signed, time-limited
 * download link usable with the same token — no separate download call.
 */
export function getFile(client: CanvasClient, args: { fileId: number | string }) {
  return client.get(`/files/${args.fileId}`);
}

/** List a course's folders (for navigating the file tree). */
export function listCourseFolders(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/folders`, {});
}

/* ---- Inbox / conversations ---- */

/** List inbox conversation threads. `scope` filters (unread/starred/archived/sent). */
export function listConversations(
  client: CanvasClient,
  args: { scope?: string } = {},
) {
  return client.getPaginated("/conversations", { scope: args.scope });
}

/**
 * Read one conversation thread.
 *
 * PRIVACY/READ-ONLY-CRITICAL: `auto_mark_as_read` defaults to TRUE on Canvas,
 * so simply *reading* a thread would mutate server state (mark it read). We
 * force `false` to keep this tool genuinely read-only. The test in
 * tests/tools.test.ts asserts this parameter.
 */
export function getConversation(
  client: CanvasClient,
  args: { conversationId: number | string },
) {
  return client.get(`/conversations/${args.conversationId}`, {
    auto_mark_as_read: false,
  });
}

/** Cheap unread-message count for the inbox. */
export function getUnreadMessageCount(client: CanvasClient) {
  return client.get("/conversations/unread_count");
}

/* ---- Groups ---- */

/** All groups the current user belongs to (course + community). */
export function listMyGroups(client: CanvasClient) {
  return client.getPaginated("/users/self/groups", {});
}

/** Details for one group you belong to. */
export function getGroup(client: CanvasClient, args: { groupId: number | string }) {
  return client.get(`/groups/${args.groupId}`);
}

/** Members of a group you belong to. */
export function listGroupMembers(
  client: CanvasClient,
  args: { groupId: number | string },
) {
  return client.getPaginated(`/groups/${args.groupId}/users`, {
    include: ["avatar_url"],
  });
}

/* ---- Calendar ---- */

/**
 * Calendar events (and assignment dates) across courses in a date window.
 *
 * The Canvas endpoint requires `context_codes[]` and caps them at 10 per call,
 * so we derive the codes from the caller's active courses and chunk requests of
 * 10, merging the results. If `courseIds` is given we use those instead.
 */
export async function listCalendarEvents(
  client: CanvasClient,
  args: {
    startDate?: string;
    endDate?: string;
    type?: string;
    courseIds?: (number | string)[];
  } = {},
) {
  let ids = args.courseIds;
  if (!ids || ids.length === 0) {
    const courses = (await listCourses(client)) as Array<{ id: number }>;
    ids = courses.map((c) => c.id);
  }
  const start = args.startDate ?? isoDaysFromNow(-1);
  const end = args.endDate ?? isoDaysFromNow(14);

  const out: unknown[] = [];
  for (const chunk of chunkArray(ids, 10)) {
    const page = await client.getPaginated("/calendar_events", {
      context_codes: chunk.map((id) => `course_${id}`),
      start_date: start,
      end_date: end,
      type: args.type ?? "event",
    });
    out.push(...page);
  }
  return out;
}

/** One calendar event or assignment-date by id. */
export function getCalendarEvent(
  client: CanvasClient,
  args: { eventId: number | string },
) {
  return client.get(`/calendar_events/${args.eventId}`);
}

/**
 * Web conferences (BigBlueButton, etc.) — live class sessions and their join
 * links. IMPORTANT: these do NOT appear in `/calendar_events`, so a "what's on
 * this week" view built only on the calendar tool misses live class sessions.
 * `/conferences` (no course) spans every enrolled course/group; `state: "live"`
 * narrows to sessions happening right now.
 */
export async function listConferences(
  client: CanvasClient,
  args: { courseId?: number | string; state?: "live" } = {},
) {
  if (args.courseId) {
    return client.getPaginated(`/courses/${args.courseId}/conferences`, {});
  }
  // Cross-course: the endpoint returns EVERY historical conference (can be
  // hundreds of KB), so bound the fetch and return the most recent by start
  // time. Pass a courseId for one course's full history.
  const all = (await client.getPaginated(
    "/conferences",
    { state: args.state },
    5,
  )) as Array<{ started_at?: string }>;
  const recent = [...all].sort(
    (a, b) =>
      new Date(b.started_at ?? 0).getTime() -
      new Date(a.started_at ?? 0).getTime(),
  );
  const LIMIT = 50;
  if (recent.length > LIMIT) {
    return {
      note: `Showing the ${LIMIT} most recent conferences across all courses. Pass a courseId for one course's full list.`,
      conferences: recent.slice(0, LIMIT),
    };
  }
  return recent;
}

/* ---- Content: pages, rubrics ---- */

/** List a course's wiki pages. */
export function listCoursePages(
  client: CanvasClient,
  args: CourseArg & { searchTerm?: string },
) {
  return client.getPaginated(`/courses/${args.courseId}/pages`, {
    search_term: args.searchTerm,
  });
}

/** Get one wiki page's body (HTML, truncated). */
export async function getCoursePage(
  client: CanvasClient,
  args: CourseArg & { pageUrl: string },
) {
  const page = (await client.get(
    `/courses/${args.courseId}/pages/${encodeURIComponent(args.pageUrl)}`,
  )) as { title?: string; body?: string; url?: string };
  return { title: page.title, url: page.url, body: summarizeHtml(page.body) };
}

/** List a course's rubrics (grading criteria). */
export function listCourseRubrics(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/rubrics`, {});
}

/** Get one rubric, including its assessments. */
export function getRubric(
  client: CanvasClient,
  args: CourseArg & { rubricId: number | string },
) {
  return client.get(`/courses/${args.courseId}/rubrics/${args.rubricId}`, {
    include: ["assessments"],
  });
}

/* ---- Quizzes (classic only — New Quizzes surface via assignments) ---- */

/** List classic quizzes in a course. */
export function listQuizzes(client: CanvasClient, args: CourseArg) {
  return client.getPaginated(`/courses/${args.courseId}/quizzes`, {});
}

/** Get one classic quiz. */
export function getQuiz(
  client: CanvasClient,
  args: CourseArg & { quizId: number | string },
) {
  return client.get(`/courses/${args.courseId}/quizzes/${args.quizId}`);
}

/** Your own submission/attempt for a classic quiz (endpoint is self-scoped). */
export function getMyQuizSubmission(
  client: CanvasClient,
  args: CourseArg & { quizId: number | string },
) {
  return client.get(
    `/courses/${args.courseId}/quizzes/${args.quizId}/submission`,
  );
}

/* ---- Peer reviews ---- */

/**
 * Peer reviews for an assignment. The Canvas endpoint has no "assigned to me"
 * filter — it returns every student's peer-review assignments — so by default we
 * fetch your own user id and keep only the ones where YOU are the reviewer
 * (`assessor_id`). Pass `mineOnly: false` to get the full list.
 */
export async function listPeerReviews(
  client: CanvasClient,
  args: CourseArg & { assignmentId: number | string; mineOnly?: boolean },
) {
  const reviews = (await client.getPaginated(
    `/courses/${args.courseId}/assignments/${args.assignmentId}/peer_reviews`,
    { include: ["user", "submission_comments"] },
  )) as Array<{ assessor_id?: number }>;
  if (args.mineOnly === false) return reviews;
  const me = (await client.get("/users/self")) as { id?: number };
  return reviews.filter((r) => r.assessor_id === me.id);
}

/* ---- Self ---- */

/** Your Canvas profile (name, avatar, primary email, etc.). */
export function getMyProfile(client: CanvasClient) {
  return client.get("/users/self/profile");
}

/**
 * Your Canvas "to-do" list (items needing action).
 *
 * Overlaps with getPlannerItems and getActivityStream: prefer to-do for
 * "what needs action right now", planner for a dated window, activity stream
 * for the social/notification feed.
 */
export function getMyTodo(client: CanvasClient) {
  return client.getPaginated("/users/self/todo", {});
}

/* ---- Roster ---- */

/**
 * The student roster for a course.
 *
 * Courses can enable "restrict students from viewing other students", which
 * makes this return 403. We degrade gracefully: instead of throwing, return an
 * explanatory object so the assistant can tell the student the roster is hidden.
 */
export async function listCoursePeople(client: CanvasClient, args: CourseArg) {
  try {
    return await client.getPaginated(`/courses/${args.courseId}/users`, {
      enrollment_type: ["student"],
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (/\b403\b/.test(msg)) {
      return {
        restricted: true,
        note: "This course restricts students from viewing the roster.",
        people: [],
      };
    }
    throw e;
  }
}

/**
 * A course's late policy (deduction percentages per interval).
 *
 * Canvas may restrict this to instructors (`manage_grades`), so we degrade
 * gracefully: on a 401/403 return an explanatory note instead of throwing, so
 * the assistant can fall back to the syllabus's stated late tiers.
 */
export async function getLatePolicy(client: CanvasClient, args: CourseArg) {
  try {
    return await client.get(`/courses/${args.courseId}/late_policy`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/\b40[13]\b/.test(msg)) {
      return {
        available: false,
        note: "This course's late policy is not readable with a student token — check the syllabus for late-penalty tiers.",
      };
    }
    throw e;
  }
}

/**
 * Semantic ("smart") search over a course's content — pages, assignments,
 * announcements, discussions — ranked by meaning, not keywords. Great for
 * "where did we cover skewness and kurtosis?". BETA on Canvas's side and not
 * enabled on every instance, so we degrade gracefully if it's unavailable.
 */
export function smartSearch(
  client: CanvasClient,
  args: CourseArg & { query: string },
) {
  return softFail(
    () =>
      client.get(`/courses/${args.courseId}/smartsearch`, { q: args.query }),
    /\b40[0134]\b/,
    {
      available: false,
      note: "Smart Search (beta) is not enabled for this course/Canvas instance.",
    },
  );
}

/**
 * A course's grading standard — the letter-grade cutoff scheme (A ≥ 93, etc.).
 * May be restricted to instructors depending on the instance, so degrade to a
 * note rather than throwing.
 */
export async function getGradingStandards(client: CanvasClient, args: CourseArg) {
  const res = await softFail(
    () => client.getPaginated(`/courses/${args.courseId}/grading_standards`, {}),
    /\b40[134]\b/,
    {
      available: false,
      note: "Grading standards are not readable with a student token for this course — check the syllabus.",
    },
  );
  // A bare [] is ambiguous (no custom standard vs quietly denied). We only reach
  // here on a 200, so an empty array genuinely means "no custom standard"; say so
  // explicitly to match the available:false shape of the denied case.
  if (Array.isArray(res) && res.length === 0) {
    return {
      available: true,
      standards: [],
      note: "This course uses Canvas's default grading scheme (no custom grading standard is configured).",
    };
  }
  return res;
}

/* ---- helpers ---- */

/** Run `fn`; if it fails with an HTTP status matching `pattern`, return `note`. */
async function softFail<T>(
  fn: () => Promise<T>,
  pattern: RegExp,
  note: object,
): Promise<T | object> {
  try {
    return await fn();
  } catch (e) {
    if (pattern.test((e as Error).message)) return note;
    throw e;
  }
}

/** Strip HTML tags and cap length so a syllabus/page body stays readable. */
export function summarizeHtml(html: string | undefined, max = 4000): string {
  if (!html) return "";
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "… [truncated]" : text;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
