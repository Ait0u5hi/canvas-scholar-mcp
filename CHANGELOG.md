# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

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
