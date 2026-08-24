---
name: canvas-discussion-catchup
description: >-
  Catch up on Canvas discussion boards — summarize threads before you post. Use
  when the student asks "what's happening in the discussion", "catch me up on
  the discussion board", "what did people say", "summarize the discussion", or
  "do I need to reply to anything". Requires the canvas-scholar-mcp server.
---

# Discussion catch-up

Summarize a course's discussions so the student can post without reading every reply.

## Steps

1. Ask which course (or use the one in context); call `canvas_list_courses` if you need the id.
2. Call `canvas_list_discussions` for that course to see the topics and which are active.
3. For the relevant topic(s), call `canvas_get_discussion_view` to get the full threaded replies.
4. Summarize the main points, points of agreement/disagreement, and whether a reply from the student is required (and by when — check the topic's due date via `canvas_get_assignment` if it's a graded discussion).

## Output template

```
## <Discussion topic>

**The gist:** <2-3 sentence summary of where the conversation is>

**Main threads**
- <Person/theme>: <one line>

**Do you need to post?** <yes/no> — <requirement, e.g. "1 initial post + 2 replies by <date>">

**If you want to reply**, here are a few angles that haven't been covered yet:
- <angle 1>
```

Summarize faithfully — don't invent positions people didn't take. Never draft a
post as if it's the student's own words unless they ask you to.
