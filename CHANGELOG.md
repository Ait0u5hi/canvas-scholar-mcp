# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [1.3.0] - 2026-09-14

### Changed

- `canvas_get_file` now returns full content — not just small text snippets —
  for any file under ~10MB, as an embedded-resource content block (decoded
  text for text-like files, base64 blob for binary files such as PDFs,
  images, and Office docs). The old 50,000-byte text-only threshold is gone;
  the 10MB threshold now applies uniformly to all content types. Files at or
  above 10MB remain metadata-only with the signed download `url`, unchanged.
  The signed-URL fetch still never reuses the authenticated Canvas API
  client, so the bearer token is never sent to the CDN host serving the file.

## [1.2.2] - 2026-09-13

A live-verified follow-up report found the 1.2.0 assignment-bloat fix was aimed at
the wrong field for graded-discussion assignments — real numbers from an actual
course pinpointed the true driver.

### Fixed

- `canvas_list_assignments`/`canvas_list_new_quizzes`/`canvas_get_assignment_groups`:
  a graded-discussion assignment embeds the ENTIRE discussion inline —
  `discussion_topic.message` (the prompt) and every reply in
  `submission.discussion_entries` — which the 1.2.0 fix (secure_params/rubric)
  didn't touch. Live-measured: one such assignment was 26,839 characters, with
  12,830 in `discussion_entries` and 5,785 in `discussion_topic.message` alone.
  `discussion_topic.message` is now truncated like `description`;
  `discussion_entries` is dropped outright with a count note, since that content
  is always reachable via `canvas_list_discussions`/`canvas_get_discussion_view`
  without needing to ride along on every assignment fetch.

## [1.2.1] - 2026-09-13

Retrospective-driven infra/correctness pass: a session cross-model review flagged
regex-based error classification as fragile (it had already caused one confirmed
false-positive risk), plus the operational gaps of hand-typed deploys and no rollback.

### Fixed

- Replaced every error-message regex used to classify a failed Canvas API call
  (`softFail`'s pattern matching, the calendar-write permission hint, the file/roster/
  late-policy/rubric/quiz/grading-standards degrade-on-403-or-404 tools) with a
  structured `CanvasApiError` (`.status`, `.kind: "rate_limit" | "forbidden" |
  "unauthorized" | "other"`) thrown by `CanvasClient` itself. This closes several
  latent instances of the same bug class the 1.2.0 permission-hint fix patched once:
  a 403 rate-limit throw and a 403 permission-denied throw share the same status and
  both contained the substring "403", so a message-regex check could misclassify a
  throttled request as a permissions issue. Checking `.kind` makes the two
  structurally distinguishable instead of relying on careful regex anchoring.
- Added a measured (not just qualitative) test asserting `listAssignments`'
  per-row size stays bounded on a deliberately worst-case fixture (a 5-criterion,
  4-rating-per-criterion rubric on every assignment), rather than only asserting
  individual fields got shorter.

### Added

- `scripts/deploy.sh` / `scripts/rollback.sh` — parameterized (git ref, systemd
  service name via env vars, no hardcoded host/service assumptions), recording the
  pre-deploy commit automatically so a rollback needs no separate bookkeeping.
- An optional `MCP_REGISTRY_SYNC_CMD` hook in `deploy.sh`: if you register this
  server in an MCP registry/gateway, point this at whatever syncs *your* registry;
  `deploy.sh` has no built-in registry integration of its own.
  `scripts/examples/sync-mlflow-registry.py` is a reference implementation against
  MLflow's MCP Server Registry specifically — one example, not a default.

## [1.2.0] - 2026-09-13

A live-verified field report caught a real gap in 1.1.0's own bloat fix, plus a genuine
new capability (planner to-do writes) and a content-fencing gap.

### Added

- `canvas_create_planner_note` / `canvas_update_planner_note` — **WRITE**,
  `destructiveHint: true`. Writes a personal "My To-Do" item
  (`/planner_notes`), optionally tagged under a course — students can tag
  any course they belong to here, unlike a calendar event, which needs
  `manage_calendar` permission Canvas rarely grants students on a course
  context.

### Fixed

- `canvas_list_assignments`'s 1.1.0 bloat fix was incomplete: it stripped
  `secure_params` but never touched an attached `rubric`'s full
  criteria/ratings tree, which some courses restrict from the dedicated
  rubric endpoints entirely — making the embedded copy the *only*
  student-readable rubric. Now truncated (not dropped) so the capability
  survives. The same trim now also applies to `canvas_list_new_quizzes` and
  `canvas_get_assignment_groups`, which hit the identical untrimmed shape and
  were missed in 1.1.0.
- Calendar tools (list/get/create/update) and `canvas_get_submission_feedback`
  /`canvas_get_planner_items`/`canvas_get_todo` now fence their responses
  against prompt injection like every other tool carrying Canvas-authored
  free text — live data confirmed a real calendar event `description` field
  carrying injected `<link>`/`<script>` tags (almost certainly Canvas/
  institution-side branding, not malicious, but the same class of content
  the fencing exists for).
- A course-context calendar write that 403s for lacking `manage_calendar`
  permission now gets an actionable hint pointing at `contextCode:
  user_<your id>`, instead of a bare 403 discovered by trial and error.
- Fixed a false-positive risk in that same permission-check logic (and in
  `canvas_list_course_files`'s existing 403 degrade): both used to match any
  error message containing the substring "403", which also matches Canvas's
  rate-limit message (`"Canvas API rate limit hit (403)..."`) — now anchored
  to the specific `"Canvas API 403 Forbidden"` throw so a throttled request
  can't be mistaken for a permissions issue.

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
