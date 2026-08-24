import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CanvasClient } from "../lib/canvas-client.js";
import * as canvas from "./canvas-tools.js";

/**
 * Wire the read-only Canvas operations up as MCP tools.
 *
 * Every tool is annotated `readOnlyHint: true` — this server never writes to
 * Canvas. `title` + hints are what the connector/extension directory looks for.
 */
export function registerTools(server: McpServer, client: CanvasClient): void {
  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });
  const ro = (title: string) => ({ title, readOnlyHint: true });
  const courseId = z
    .union([z.number(), z.string()])
    .describe("Canvas course id");

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
          .enum(["past", "overdue", "undated", "ungraded", "unsubmitted", "upcoming", "future"])
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
      inputSchema: {
        courseId,
        assignmentId: z.union([z.number(), z.string()]),
      },
    },
    async (args) => ok(await canvas.getAssignment(client, args)),
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
      inputSchema: {
        courseId,
        topicId: z.union([z.number(), z.string()]).describe("Discussion topic id"),
      },
    },
    async (args) => ok(await canvas.getDiscussionView(client, args)),
  );

  server.registerTool(
    "canvas_get_missing_submissions",
    {
      ...ro("Get my missing submissions"),
      description: "Assignments you have not submitted that are due/overdue.",
      inputSchema: {
        courseIds: z
          .array(z.union([z.number(), z.string()]))
          .optional()
          .describe("Optionally limit to these course ids"),
      },
    },
    async (args) => ok(await canvas.getMissingSubmissions(client, args)),
  );

  server.registerTool(
    "canvas_get_planner_items",
    {
      ...ro("Get my planner / upcoming items"),
      description:
        "Planner items (assignments, quizzes, events) in a date window. " +
        "Defaults to yesterday..+14 days if no dates are given.",
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
      description: "Your recent Canvas activity (announcements, messages, etc.).",
      inputSchema: {},
    },
    async () => ok(await canvas.getActivityStream(client)),
  );

  server.registerTool(
    "canvas_list_modules",
    {
      ...ro("List course modules"),
      description: "List modules in a course, with their items.",
      inputSchema: { courseId },
    },
    async (args) => ok(await canvas.listModules(client, args)),
  );
}
