# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [0.2.0] - Unreleased

### Added

- **~24 new read-only student tools** (11 → 36 total): submission feedback
  (comments + rubric), weighted grade breakdown, announcements, syllabus, course
  files/folders/get-file, inbox (list/read/unread-count), groups (mine/detail/
  members), calendar events, pages, rubrics, classic quizzes + my quiz
  submission, profile, to-do, and the class roster.
- **5 Agent Skills** in `skills/`: `canvas-week-plan`, `canvas-student-todo`,
  `canvas-am-i-on-track`, `canvas-discussion-catchup`, `canvas-module-progress`.

### Fixed

- Tool annotations are now nested under `annotations` so `readOnlyHint` (plus
  `idempotentHint`/`openWorldHint`/`destructiveHint`) actually reach the client
  instead of being silently dropped.

### Notes / correctness

- Reading an inbox thread forces `auto_mark_as_read=false` so the server never
  mutates your inbox.
- Calendar events auto-derive course contexts and chunk them (Canvas caps at 10
  per request).
- The roster tool degrades gracefully (returns a note, not an error) when a
  course hides the student roster.

### Changed

- Dropped EOL Node 18; requires Node ≥ 20. Dev tooling upgraded (vitest 4,
  eslint 10); `npm audit` clean.

## [0.1.0] - Unreleased

### Added

- Initial student-focused Canvas LMS MCP server (read-only, stdio).
- 11 tools: courses, assignments, assignment detail, grades (all + per-course),
  discussions, threaded discussion view, missing submissions, planner items,
  activity stream, modules.
- Native `fetch`-based Canvas client with Link-header pagination and a non-JSON
  response guard.
- Privacy regression test enforcing `user_id: "self"` scoping on per-course grades.
- `.mcpb` manifest (keychain-backed token) and `server.json` for the MCP registry.
- GitHub Actions CI (typecheck + lint + test).
