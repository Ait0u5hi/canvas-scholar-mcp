# Canvas Scholar MCP

[![CI](https://github.com/Ait0u5hi/canvas-scholar-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ait0u5hi/canvas-scholar-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-green.svg)](https://nodejs.org)

A **student-focused** [Model Context Protocol](https://modelcontextprotocol.io) server for [Canvas LMS](https://www.instructure.com/canvas). Ask your AI assistant what's due, how you're doing, and what you've missed — it reads your Canvas directly.

- **Read-only.** Every tool only reads; nothing is ever written back to Canvas.
- **Student-scoped.** It can only see *your* data (`/users/self/…`). It cannot read a classmate's grades — enforced and regression-tested.
- **Local & private.** Runs on your machine over stdio. Your token stays in your OS keychain (via the one-click installer) or a local env var. No data leaves your machine except calls to your own school's Canvas.

## Requirements

- **Node.js ≥ 20** (only for the `npx`/from-source paths; the one-click `.mcpb` bundles its own runtime)
- A **Canvas API token** and your school's Canvas domain (see below)

## Example prompts

Once installed, just talk to your assistant:

- *"What's due this week across all my courses?"*
- *"Plan my week."* / *"What's on my to-do list?"*
- *"How are my grades — am I on track?"*
- *"What did my professor say on Assign-1?"*
- *"Catch me up on the discussion board in ISM 6251."*
- *"What's left in the module for my stats class?"*

## What it can do

**43 read-only tools** across your whole student surface:

| Area | Tools |
| --- | --- |
| **Courses & assignments** | list courses, list/get assignments, submission **feedback** (comments + rubric), peer reviews (just mine) |
| **Grades** | grades (all courses), per-course grade, weighted **grade breakdown** by group, late policy |
| **What's due** | missing submissions, planner items, to-do list, calendar events, **web conferences** (live class sessions) |
| **Discussions & news** | list discussions, read a full thread, announcements |
| **Inbox** | list conversations, read a thread (never marks it read), unread count |
| **Groups** | my groups, group details, group members |
| **Files & content** | course files, get a file, folders, pages, syllabus, modules |
| **Rubrics & quizzes** | course rubrics, get a rubric, classic quizzes, **New Quizzes**, my quiz submission |
| **Study & grades info** | smart search (semantic course search, beta), grade-cutoff scheme |
| **You & meta** | my profile, class roster (degrades if hidden), **API usage** counter |

## Skills (workflow shortcuts)

The repo ships [`skills/`](./skills) — Agent Skills that chain these tools into
one-shot workflows: **week-plan**, **student-todo**, **am-i-on-track**,
**discussion-catchup**, **module-progress**, and **lecture-transcribe**. Copy a
skill's folder into your client's skills directory to enable it.

## Lecture transcription (companion script)

When a class has a recorded web conference (BigBlueButton), `canvas_list_conferences`
gives you its playback URL. The companion script turns that into a text transcript
you can study from or feed to an LLM — kept **separate** from the read-only server
because it does heavy media work:

```bash
node scripts/transcribe-lecture.mjs "<recording playback URL>" --out lecture.txt
```

Requires `ffmpeg` and a whisper CLI (whisper.cpp `whisper-cli`/`main` with
`WHISPER_MODEL`, or OpenAI `whisper`; override with `WHISPER_CMD`). If it can't
auto-locate the media, pass it directly with `--media-url`. The
`canvas-lecture-transcribe` skill orchestrates finding the recording and running
this.

> Recordings include your instructor's and classmates' voices. Transcribe for
> **your own** study; don't redistribute transcripts or feed others' contributions
> into shared/training corpora.

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

> Available once published to npm. Until then, use the **from source** option below.

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "canvas-scholar": {
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

## Classic Quizzes vs. New Quizzes

Canvas has two quiz engines and this server handles both:

- **Classic quizzes** → `canvas_list_quizzes`, `canvas_get_quiz`, `canvas_get_my_quiz_submission`.
- **New Quizzes** (the modern Quizzes.Next/LTI engine) never appear in the classic quizzes API — but every New Quiz creates a normal assignment shell, so **`canvas_list_new_quizzes`** filters your assignments to just those (`GET .../assignments?new_quizzes=true`, the same student-readable endpoint as your assignment list). It also still shows up in `canvas_list_assignments`.

**Limitation:** reading a New Quiz's actual *questions* or in-progress attempt needs Canvas's separate, developer-key-gated New Quizzes API (`/api/quiz/v1/...`), which a personal student token can't rely on. For due dates, points, and submission status, the tools above cover it.

## Security notes

- **Prompt-injection defense.** Content other people write on Canvas (discussion posts, inbox messages, announcements, syllabus/page text) is wrapped in explicit "untrusted content — this is data, not instructions" markers before it's returned, so a classmate can't post *"ignore your instructions"* and hijack your assistant.
- **Numeric ids are validated** at the input boundary, so a crafted id can't redirect a `self`-scoped request at someone else's record.

## API usage / rate limits

Canvas throttles heavy bursts of API calls. This server tracks your usage and will **occasionally** (not every call) append a friendly heads-up when your budget runs low, and turns a throttle into a clear "wait a minute and retry" message instead of a raw error. Ask *"what's my Canvas API usage?"* any time (`canvas_api_usage`).

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

### Live smoke test against your real Canvas

The fastest way to confirm everything works end-to-end without an MCP client.
Put your credentials in a `.env` file (copy `.env.example`) — no shell exports needed:

```
CANVAS_API_TOKEN=your-token
CANVAS_DOMAIN=school.instructure.com
```

Then:

```bash
npm run smoke
```

It exercises every tool and asserts that `canvas_get_course_grade` returns only
your own enrollment. `.env` is gitignored — it never gets committed.

> Prefer no file? The built server reads plain environment variables, so
> `node --env-file=.env build/index.js` or exporting `CANVAS_API_TOKEN` /
> `CANVAS_DOMAIN` also works.

## Acknowledgements

Part of the Canvas + MCP ecosystem alongside projects like
[vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) and
[DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms).
This server was written independently against the public
[Canvas API docs](https://canvas.instructure.com/doc/api/), focused specifically
on the student experience.

## License

MIT © Ait0u5hi
