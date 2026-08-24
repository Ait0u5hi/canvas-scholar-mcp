# Canvas Scholar MCP

A **student-focused** [Model Context Protocol](https://modelcontextprotocol.io) server for [Canvas LMS](https://www.instructure.com/canvas). Ask your AI assistant what's due, how you're doing, and what you've missed — it reads your Canvas directly.

- **Read-only.** Every tool only reads; nothing is ever written back to Canvas.
- **Student-scoped.** It can only see *your* data (`/users/self/…`). It cannot read a classmate's grades — enforced and regression-tested.
- **Local & private.** Runs on your machine over stdio. Your token stays in your OS keychain (via the one-click installer) or a local env var. No data leaves your machine except calls to your own school's Canvas.

## What it can do

| Tool | What you get |
| --- | --- |
| `canvas_list_courses` | Your enrolled courses |
| `canvas_list_assignments` | Assignments in a course, with your submission status |
| `canvas_get_assignment` | One assignment + your submission |
| `canvas_get_grades` | Your current grade in every course |
| `canvas_get_course_grade` | Your grade in one course |
| `canvas_list_discussions` | Discussion topics in a course |
| `canvas_get_discussion_view` | A full threaded discussion, including reply text |
| `canvas_get_missing_submissions` | What you haven't turned in |
| `canvas_get_planner_items` | Upcoming items in a date window |
| `canvas_get_activity_stream` | Your recent Canvas activity |
| `canvas_list_modules` | A course's modules and items |

## Get a Canvas API token

1. In Canvas, go to **Account → Settings**.
2. Under **Approved Integrations**, click **+ New Access Token**.
3. Give it a purpose (e.g. "Canvas Scholar MCP") and — recommended — an **expiration date**.
4. Copy the token. Treat it like a password; it grants access to your account.

Your **Canvas domain** is the host in your Canvas URL, e.g. `school.instructure.com`.

## Install

### Claude Desktop — one-click (recommended)

Download `canvas-scholar-mcp.mcpb` from the [latest release](https://github.com/Ait0u5hi/canvas-scholar-mcp/releases) and double-click it. Claude Desktop will prompt for your token (stored in your OS keychain) and domain. No JSON, no Node install.

### Claude Desktop / Cursor / any MCP client — via npx

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["-y", "canvas-scholar-mcp"],
      "env": {
        "CANVAS_API_TOKEN": "your-token-here",
        "CANVAS_DOMAIN": "school.instructure.com"
      }
    }
  }
}
```

> On Windows, if `npx` isn't found, use the full path to `npx.cmd` or install globally with `npm i -g canvas-scholar-mcp` and use `"command": "canvas-scholar-mcp"`.

### From source

```bash
git clone https://github.com/Ait0u5hi/canvas-scholar-mcp
cd canvas-scholar-mcp
npm ci && npm run build
# point your client at:  node /absolute/path/to/build/index.js
```

## A note on "New Quizzes"

Canvas's modern **New Quizzes** engine does **not** appear in the classic quizzes API, so a "list quizzes" tool would silently miss them. That's why this server has no quizzes tool: New Quizzes still create a normal assignment shell, so **`canvas_list_assignments` catches them** (and everything else). Ask for assignments, not quizzes.

## Privacy & security

- The server never writes to Canvas and never logs your token or personal data.
- Use a token with an expiration date and the narrowest scope your institution allows.
- Because it only ever reads your own account, it needs no anonymization machinery — the trust boundary is "your token, your data." See [`SECURITY.md`](./SECURITY.md).

## Development

```bash
npm ci
npm test         # unit tests (includes the privacy regression guard)
npm run typecheck
npm run build
npm run dev      # run from source over stdio
```

## Acknowledgements

Part of the Canvas + MCP ecosystem alongside projects like
[vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) and
[DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms).
This server was written independently against the public
[Canvas API docs](https://canvas.instructure.com/doc/api/), focused specifically
on the student experience.

## License

MIT © Ait0u5hi
