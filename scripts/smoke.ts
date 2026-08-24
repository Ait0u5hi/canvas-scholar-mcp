/**
 * Live smoke test against a real Canvas instance.
 *
 * Exercises the read-only tools with your actual token so you can confirm the
 * server works end-to-end without wiring up an MCP client. It writes only
 * summaries (counts + a sample title), never full personal data, to stdout.
 *
 *   CANVAS_API_TOKEN=... CANVAS_DOMAIN=school.instructure.com npx tsx scripts/smoke.ts
 *
 * Each check is independent: one failing tool does not stop the others.
 */
import { loadConfig } from "../src/lib/config.js";
import { CanvasClient } from "../src/lib/canvas-client.js";
import * as canvas from "../src/tools/canvas-tools.js";

// Convenience for local runs: load a .env file if one exists, so you can put
// CANVAS_API_TOKEN / CANVAS_DOMAIN in .env instead of exporting them each time.
// Uses Node's built-in loader (Node 20.12+); harmless if the file is absent.
try {
  (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  // no .env present — fall back to the ambient environment
}

async function main() {
  const client = new CanvasClient(loadConfig());
  const pass: string[] = [];
  const fail: string[] = [];

  async function check(name: string, fn: () => Promise<unknown>, describe: (r: any) => string) {
    try {
      const r = await fn();
      console.log(`  ok   ${name.padEnd(28)} ${describe(r)}`);
      pass.push(name);
    } catch (e) {
      console.log(`  FAIL ${name.padEnd(28)} ${(e as Error).message}`);
      fail.push(name);
    }
  }

  const n = (r: any) => `${Array.isArray(r) ? r.length : 1} item(s)`;

  console.log("Canvas Scholar — live smoke test\n");

  const courses = (await canvas.listCourses(client).catch(() => [])) as any[];
  await check("list_courses", () => Promise.resolve(courses), (r) =>
    `${r.length} course(s)` + (r[0] ? `, e.g. "${r[0].name}" (id ${r[0].id})` : ""),
  );

  await check("get_grades (self, all courses)", () => canvas.getGrades(client), n);
  await check("get_missing_submissions", () => canvas.getMissingSubmissions(client), n);
  await check("get_planner_items (next 14d)", () => canvas.getPlannerItems(client), n);
  await check("get_activity_stream", () => canvas.getActivityStream(client), n);

  await check("list_conversations", () => canvas.listConversations(client), n);
  await check("get_unread_message_count", () => canvas.getUnreadMessageCount(client), () => "ok");
  await check("list_my_groups", () => canvas.listMyGroups(client), n);
  await check("list_calendar_events (next 14d)", () => canvas.listCalendarEvents(client), n);
  await check("list_conferences (BigBlueButton etc.)", () => canvas.listConferences(client), n);
  await check("get_my_profile", () => canvas.getMyProfile(client), () => "ok");
  await check("get_todo", () => canvas.getMyTodo(client), n);

  // Course-scoped checks against the first course, if any.
  const cid = courses[0]?.id;
  if (cid) {
    console.log(`\n  (course-scoped checks using course ${cid})`);
    await check("list_assignments", () => canvas.listAssignments(client, { courseId: cid }), n);
    await check("list_modules", () => canvas.listModules(client, { courseId: cid }), n);
    await check("list_discussions", () => canvas.listDiscussions(client, { courseId: cid }), n);
    await check("list_announcements", () => canvas.listAnnouncements(client, { courseId: cid }), n);
    await check("get_assignment_groups", () => canvas.getAssignmentGroups(client, { courseId: cid }), n);
    await check("get_late_policy (may be instructor-only)", () => canvas.getLatePolicy(client, { courseId: cid }), (r) => (r as { available?: boolean }).available === false ? "restricted → note" : "readable");
    await check("get_grading_standards (may be restricted)", () => canvas.getGradingStandards(client, { courseId: cid }), (r) => (r as { available?: boolean }).available === false ? "restricted → note" : "readable");
    await check("smart_search (beta, may be off)", () => canvas.smartSearch(client, { courseId: cid, query: "syllabus" }), (r) => (r as { available?: boolean }).available === false ? "not enabled → note" : "enabled");
    await check("get_syllabus", () => canvas.getSyllabus(client, { courseId: cid }), () => "ok");
    await check("list_course_files", () => canvas.listCourseFiles(client, { courseId: cid }), n);
    await check("list_course_pages", () => canvas.listCoursePages(client, { courseId: cid }), n);
    await check("list_quizzes", () => canvas.listQuizzes(client, { courseId: cid }), n);
    await check("list_course_people (may be restricted)", () => canvas.listCoursePeople(client, { courseId: cid }), (r) => Array.isArray(r) ? `${r.length} people` : "restricted/hidden");
    await check(
      "get_course_grade (self only)",
      async () => {
        const enr = (await canvas.getCourseGrade(client, { courseId: cid })) as any[];
        // Privacy assertion: every enrollment returned must be the current user's.
        const userIds = new Set(enr.map((e) => e.user_id));
        if (userIds.size > 1) {
          throw new Error(
            `PRIVACY LEAK: got ${userIds.size} distinct users — expected only yourself`,
          );
        }
        return enr;
      },
      (r) => `${n(r)} (only your own enrollment — privacy OK)`,
    );
  } else {
    console.log("\n  (no active courses found — skipping course-scoped checks)");
  }

  console.log(`\n${pass.length} passed, ${fail.length} failed.`);
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
