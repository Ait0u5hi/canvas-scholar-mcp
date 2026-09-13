# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [1.1.0] - 2026-09-13

First deliberate write capability: two confirmation-gated calendar tools, plus
group-scoped discussion reads and a handful of correctness fixes.

### Added

- `canvas_create_calendar_event` / `canvas_update_calendar_event` — **WRITE**,
  `destructiveHint: true`. Both re-check their `contextCode` against the
  caller's own courses/groups/user id before writing.
- `canvas_list_group_discussions` / `canvas_get_group_discussion_view` —
  group-scoped discussion topics, previously only reachable at the course
  level (a per-group topic 404'd against the course-level endpoint).
- `canvas_get_file` now includes a `content` field for small, text-like files
  (size- and content-type-gated, streamed with a hard byte cap, never reuses
  the authenticated client for the signed download URL).

### Fixed

- `canvas_list_quizzes` no longer throws on a course with the classic-Quizzes
  feature disabled — degrades to a note like its sibling tools, instead of an
  unhandled 404.
- `CanvasClient` write failures now surface Canvas's actual `errors[]`/`message`
  body instead of a bare "400 Bad Request", and a `204 No Content` response no
  longer throws a parse error.
- `canvas_list_course_files` no longer throws on a course that restricts file
  listing to instructors — degrades to a note like its sibling tools, instead
  of an unhandled 403.
- `canvas_list_assignments`/`canvas_get_assignment` bloat: assignments always
  carried Canvas's `secure_params` (an LTI-launch JWT, irrelevant to a read
  tool) and an untruncated `description`. Now stripped/truncated per-row — a
  course-scoped list is naturally bounded by course size, so the fix is
  per-row trimming, not a row-count cap (which would risk hiding a real
  assignment).
- `canvas_list_discussions`/`canvas_list_group_discussions` now truncate each
  topic's `message` body to a preview (full text is one `getDiscussionView`/
  `getGroupDiscussionView` call away) — the same token-budget rationale as
  the assignments fix above.

## [1.0.0] - 2026-08-24

First public release. 43 read-only, student-scoped Canvas tools, 6 agent skills,
a companion lecture-transcribe script, prompt-injection fencing, and API-usage
awareness — live-verified against a real Canvas instance. The 0.1–0.4
entries below are the pre-release development history.

### Added

- `canvas_list_new_quizzes` — finds New Quizzes via their assignment shells
  (`assignments?new_quizzes=true`), resolving the long-standing New-Quizzes gap.
- `canvas_api_usage` — reports request count + Canvas's remaining rate-limit
  budget; the server also appends an occasional low-budget heads-up (not every
  call) and turns a throttle into a friendly "wait and retry" message.
- **Richer, legitimately-yours data via `include[]`:** assignments now carry
  class `score_statistics` (aggregate min/max/mean/quartiles — how you compare,
  no per-student data, gated by Canvas's own ≥5-submissions rule); the course
  list is enriched into a grade/progress/teacher dashboard; modules include
  per-item lock/completion `content_details`.

### Security

- **Prompt-injection defense:** Canvas-user-authored text (discussions, inbox,
  announcements, syllabus, pages, activity) is wrapped in untrusted-content
  provenance markers before return, with a linear-time spoofed-marker neutralizer.
- **Numeric id validation** at the input boundary prevents path-injection on
  `self`-scoped requests.

### Fixed

- Tool annotations nest under `annotations` so `readOnlyHint` et al. actually
  reach the client instead of being silently dropped.
- `canvas_list_conferences` (unscoped) caps to the 50 most recent instead of
  dumping full history; `canvas_get_grading_standards` returns an explicit note
  instead of a bare `[]`.
- `canvas_list_course_rubrics` / `canvas_get_rubric` (403) and
  `canvas_list_course_pages` (404) now degrade to an explanatory note instead of
  throwing, matching the roster/late-policy behavior.

## [0.3.0] - pre-release

### Added

- `canvas_list_conferences` — live web conferences (BigBlueButton) with join
  links; closes a real "plan my week misses my live class" gap. Wired into the
  `canvas-week-plan` skill.
- `canvas_list_peer_reviews` (filtered to just yours), `canvas_get_late_policy`,
  `canvas_smart_search` (semantic search, beta), `canvas_get_grading_standards`
  — the permission-uncertain ones degrade gracefully to a note.
- **Companion script** `scripts/transcribe-lecture.mjs` + the
  `canvas-lecture-transcribe` skill — turn a BigBlueButton recording into a
  whisper transcript for study/LLM ingestion, kept out of the read-only server.

## [0.2.0] - pre-release

### Added

- Expanded from 11 to ~35 read-only student tools: submission feedback
  (comments + rubric), weighted grade breakdown, announcements, syllabus, files,
  inbox, groups, calendar, pages, rubrics, classic quizzes, profile, to-do,
  roster.
- **Agent Skills** in `skills/`: week-plan, student-todo, am-i-on-track,
  discussion-catchup, module-progress.

### Changed

- Dropped EOL Node 18 (requires Node ≥ 20); dev tooling upgraded (vitest 4,
  eslint 10); `npm audit` clean.

## [0.1.0] - pre-release

### Added

- Initial student-focused Canvas LMS MCP server (read-only, stdio): 11 tools,
  native-`fetch` client with pagination, a privacy regression test enforcing
  `user_id: "self"` grade scoping, `.mcpb` manifest, and `server.json`.
