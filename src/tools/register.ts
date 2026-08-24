import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CanvasClient } from "../lib/canvas-client.js";
import * as canvas from "./canvas-tools.js";

/**
 * Wire the read-only Canvas operations up as MCP tools.
 *
 * Every tool is annotated read-only and non-destructive. The hints live under
 * an `annotations` object (that is where the MCP SDK reads them from); putting
 * them at the top level silently drops them and the client falls back to the
 * pessimistic assumed-destructive posture.
 */
export function registerTools(server: McpServer, client: CanvasClient): void {
  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });
  const ro = (title: string) => ({
    title,
    annotations: {
      title,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  });
  const id = z.union([z.number(), z.string()]);
  const courseId = id.describe("Canvas course id");

  /* -------------------- courses / assignments / grades -------------------- */

  server.registerTool(
    "canvas_list_courses",
    {
      ...ro("List my courses"),
      description: "List the courses you are enrolled in.",
      inputSchema: {
        includeConcluded: z
          .boolean()
          .optional()
          .describe("Include concluded/past courses (default false)"),
      },
    },
    async (args) => ok(await canvas.listCourses(client, args)),
  );

  server.registerTool(
    "canvas_list_assignments",
    {
      ...ro("List assignments in a course"),
      description:
        "List assignments in a course, with your submission status. " +
        "Note: Canvas 'New Quizzes' do not appear in the quizzes endpoint but " +
        "DO appear here as assignments.",
      inputSchema: {
        courseId,
        bucket: z
          .enum([
            "past",
            "overdue",
            "undated",
            "ungraded",
            "unsubmitted",
            "upcoming",
            "future",
          ])
          .optional()
          .describe("Optional filter, e.g. 'upcoming'"),
      },
    },
    async (args) => ok(await canvas.listAssignments(client, args)),
  );

  server.registerTool(
    "canvas_get_assignment",
    {
      ...ro("Get an assignment"),
      description: "Get one assignment (with your submission) by id.",
      inputSchema: { courseId, assignmentId: id },
    },
    async (args) => ok(await canvas.getAssignment(client, args)),
  );

  server.registerTool(
    "canvas_get_submission_feedback",
    {
      ...ro("Get my feedback on an assignment"),
      description:
        "Your submission for one assignment WITH the professor's comments, " +
        "rubric assessment, and attempt history. Use to answer 'what did my " +
        "professor say / how was I graded?'.",
      inputSchema: { courseId, assignmentId: id },
    },
    async (args) => ok(await canvas.getSubmissionFeedback(client, args)),
  );

  server.registerTool(
    "canvas_get_grades",
    {
      ...ro("Get my grades (all courses)"),
      description: "Your current grade in every active course.",
      inputSchema: {},
    },
    async () => ok(await canvas.getGrades(client)),
  );

  server.registerTool(
    "canvas_get_course_grade",
    {
      ...ro("Get my grade in one course"),
      description: "Your grade in a single course (only your own enrollment).",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.getCourseGrade(client, args)),
  );

  server.registerTool(
    "canvas_get_assignment_groups",
    {
      ...ro("Get weighted grade breakdown"),
      description:
        "Assignment groups with their weights and your submissions — shows the " +
        "weighted breakdown behind a course grade. Drop rules are reported but " +
        "not pre-applied.",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.getAssignmentGroups(client, args)),
  );

  server.registerTool(
    "canvas_get_missing_submissions",
    {
      ...ro("Get my missing submissions"),
      description: "Assignments you have not submitted that are due/overdue.",
      inputSchema: {
        courseIds: z
          .array(id)
          .optional()
          .describe("Optionally limit to these course ids"),
      },
    },
    async (args) => ok(await canvas.getMissingSubmissions(client, args)),
  );

  /* -------------------- planning / activity -------------------- */

  server.registerTool(
    "canvas_get_planner_items",
    {
      ...ro("Get my planner / upcoming items"),
      description:
        "Planner items (assignments, quizzes, events) in a date window. " +
        "Defaults to yesterday..+14 days. Canvas's unified 'what's due/new' feed.",
      inputSchema: {
        startDate: z.string().optional().describe("ISO date, e.g. 2026-08-24"),
        endDate: z.string().optional().describe("ISO date, e.g. 2026-09-07"),
      },
    },
    async (args) => ok(await canvas.getPlannerItems(client, args)),
  );

  server.registerTool(
    "canvas_get_activity_stream",
    {
      ...ro("Get my activity stream"),
      description:
        "Your recent Canvas activity (announcements, messages, submissions). " +
        "The social/notification feed; for action items prefer planner or todo.",
      inputSchema: {},
    },
    async () => ok(await canvas.getActivityStream(client)),
  );

  server.registerTool(
    "canvas_get_todo",
    {
      ...ro("Get my to-do list"),
      description:
        "Your Canvas to-do list — items needing action right now. Overlaps with " +
        "planner (dated window) and activity stream (feed); prefer this for " +
        "'what needs action'.",
      inputSchema: {},
    },
    async () => ok(await canvas.getMyTodo(client)),
  );

  /* -------------------- calendar -------------------- */

  server.registerTool(
    "canvas_list_calendar_events",
    {
      ...ro("List my calendar events"),
      description:
        "Calendar events and assignment dates across your courses in a date " +
        "window (defaults to yesterday..+14 days). Course contexts are derived " +
        "automatically. Use planner for the unified due feed; use this for raw " +
        "calendar events like office hours. NOTE: live web conferences " +
        "(BigBlueButton class sessions) do NOT appear here — use " +
        "canvas_list_conferences for those.",
      inputSchema: {
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        type: z
          .enum(["event", "assignment"])
          .optional()
          .describe("event (default) or assignment"),
        courseIds: z.array(id).optional().describe("Limit to these course ids"),
      },
    },
    async (args) => ok(await canvas.listCalendarEvents(client, args)),
  );

  server.registerTool(
    "canvas_list_conferences",
    {
      ...ro("List my web conferences"),
      description:
        "Live/scheduled web conferences (BigBlueButton class sessions, etc.) " +
        "with their join links — across all your courses, or one course. These " +
        "are NOT in the calendar, so use this to catch live class sessions.",
      inputSchema: {
        courseId: courseId.optional().describe("Limit to one course (optional)"),
        state: z
          .literal("live")
          .optional()
          .describe("Only sessions happening right now"),
      },
    },
    async (args) => ok(await canvas.listConferences(client, args)),
  );

  server.registerTool(
    "canvas_get_calendar_event",
    {
      ...ro("Get a calendar event"),
      description: "Get one calendar event or assignment-date by id.",
      inputSchema: { eventId: id },
    },
    async (args) => ok(await canvas.getCalendarEvent(client, args)),
  );

  /* -------------------- discussions / announcements -------------------- */

  server.registerTool(
    "canvas_list_discussions",
    {
      ...ro("List discussion topics"),
      description: "List discussion topics in a course (metadata only).",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listDiscussions(client, args)),
  );

  server.registerTool(
    "canvas_get_discussion_view",
    {
      ...ro("Read a discussion thread"),
      description:
        "Full threaded view of a discussion topic, including reply bodies.",
      inputSchema: { courseId, topicId: id.describe("Discussion topic id") },
    },
    async (args) => ok(await canvas.getDiscussionView(client, args)),
  );

  server.registerTool(
    "canvas_list_announcements",
    {
      ...ro("List course announcements"),
      description: "Recent announcements for a course.",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listAnnouncements(client, args)),
  );

  /* -------------------- inbox / conversations -------------------- */

  server.registerTool(
    "canvas_list_conversations",
    {
      ...ro("List my inbox"),
      description: "List your inbox conversation threads.",
      inputSchema: {
        scope: z
          .enum(["unread", "starred", "archived", "sent"])
          .optional()
          .describe("Optional filter"),
      },
    },
    async (args) => ok(await canvas.listConversations(client, args)),
  );

  server.registerTool(
    "canvas_get_conversation",
    {
      ...ro("Read an inbox thread"),
      description:
        "Read one inbox conversation thread. Does not mark it as read (stays " +
        "read-only).",
      inputSchema: { conversationId: id },
    },
    async (args) => ok(await canvas.getConversation(client, args)),
  );

  server.registerTool(
    "canvas_get_unread_message_count",
    {
      ...ro("Get my unread message count"),
      description: "How many unread inbox messages you have.",
      inputSchema: {},
    },
    async () => ok(await canvas.getUnreadMessageCount(client)),
  );

  /* -------------------- groups -------------------- */

  server.registerTool(
    "canvas_list_my_groups",
    {
      ...ro("List my groups"),
      description: "All groups you belong to (course project groups + community).",
      inputSchema: {},
    },
    async () => ok(await canvas.listMyGroups(client)),
  );

  server.registerTool(
    "canvas_get_group",
    {
      ...ro("Get a group"),
      description: "Details for one group you belong to.",
      inputSchema: { groupId: id },
    },
    async (args) => ok(await canvas.getGroup(client, args)),
  );

  server.registerTool(
    "canvas_list_group_members",
    {
      ...ro("List group members"),
      description: "The members of a group you belong to.",
      inputSchema: { groupId: id },
    },
    async (args) => ok(await canvas.listGroupMembers(client, args)),
  );

  /* -------------------- files -------------------- */

  server.registerTool(
    "canvas_list_course_files",
    {
      ...ro("List course files"),
      description:
        "List files in a course. Locked/hidden folders are excluded automatically.",
      inputSchema: {
        courseId,
        searchTerm: z.string().optional().describe("Filter by name"),
      },
    },
    async (args) => ok(await canvas.listCourseFiles(client, args)),
  );

  server.registerTool(
    "canvas_get_file",
    {
      ...ro("Get a file"),
      description:
        "File metadata by id. The returned `url` is a ready-to-use download link.",
      inputSchema: { fileId: id },
    },
    async (args) => ok(await canvas.getFile(client, args)),
  );

  server.registerTool(
    "canvas_list_course_folders",
    {
      ...ro("List course folders"),
      description: "List a course's folders (for navigating the file tree).",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listCourseFolders(client, args)),
  );

  /* -------------------- content: modules, pages, syllabus, rubrics -------- */

  server.registerTool(
    "canvas_list_modules",
    {
      ...ro("List course modules"),
      description: "List modules in a course, with their items.",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listModules(client, args)),
  );

  server.registerTool(
    "canvas_list_course_pages",
    {
      ...ro("List course pages"),
      description: "List a course's wiki/content pages.",
      inputSchema: {
        courseId,
        searchTerm: z.string().optional().describe("Filter by title"),
      },
    },
    async (args) => ok(await canvas.listCoursePages(client, args)),
  );

  server.registerTool(
    "canvas_get_course_page",
    {
      ...ro("Read a course page"),
      description: "Get one wiki page's content (HTML stripped to text).",
      inputSchema: {
        courseId,
        pageUrl: id.describe("Page url slug or id"),
      },
    },
    async (args) =>
      ok(await canvas.getCoursePage(client, { ...args, pageUrl: String(args.pageUrl) })),
  );

  server.registerTool(
    "canvas_get_syllabus",
    {
      ...ro("Get a course syllabus"),
      description: "A course's syllabus text (HTML stripped, truncated).",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.getSyllabus(client, args)),
  );

  server.registerTool(
    "canvas_list_course_rubrics",
    {
      ...ro("List course rubrics"),
      description: "List a course's rubrics (grading criteria).",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listCourseRubrics(client, args)),
  );

  server.registerTool(
    "canvas_get_rubric",
    {
      ...ro("Get a rubric"),
      description: "Get one rubric with its criteria and assessments.",
      inputSchema: { courseId, rubricId: id },
    },
    async (args) => ok(await canvas.getRubric(client, args)),
  );

  /* -------------------- quizzes (classic) -------------------- */

  server.registerTool(
    "canvas_list_quizzes",
    {
      ...ro("List classic quizzes"),
      description:
        "List classic quizzes in a course. New Quizzes do NOT appear here — " +
        "they surface via canvas_list_assignments.",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listQuizzes(client, args)),
  );

  server.registerTool(
    "canvas_get_quiz",
    {
      ...ro("Get a classic quiz"),
      description: "Get one classic quiz by id.",
      inputSchema: { courseId, quizId: id },
    },
    async (args) => ok(await canvas.getQuiz(client, args)),
  );

  server.registerTool(
    "canvas_get_my_quiz_submission",
    {
      ...ro("Get my quiz submission"),
      description: "Your own attempt/submission for a classic quiz.",
      inputSchema: { courseId, quizId: id },
    },
    async (args) => ok(await canvas.getMyQuizSubmission(client, args)),
  );

  /* -------------------- self / roster -------------------- */

  server.registerTool(
    "canvas_list_peer_reviews",
    {
      ...ro("List my peer reviews"),
      description:
        "Peer reviews for an assignment. By default returns only the ones " +
        "assigned to YOU (you as the reviewer); pass mineOnly=false for all.",
      inputSchema: {
        courseId,
        assignmentId: id,
        mineOnly: z
          .boolean()
          .optional()
          .describe("Only reviews assigned to you (default true)"),
      },
    },
    async (args) => ok(await canvas.listPeerReviews(client, args)),
  );

  server.registerTool(
    "canvas_get_my_profile",
    {
      ...ro("Get my profile"),
      description: "Your Canvas profile (name, avatar, primary email).",
      inputSchema: {},
    },
    async () => ok(await canvas.getMyProfile(client)),
  );

  server.registerTool(
    "canvas_list_course_people",
    {
      ...ro("List course classmates"),
      description:
        "The student roster for a course. If the course hides the roster, " +
        "returns a note instead of an error.",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listCoursePeople(client, args)),
  );
}
