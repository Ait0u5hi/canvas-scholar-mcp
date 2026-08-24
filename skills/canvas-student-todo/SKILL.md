---
name: canvas-student-todo
description: >-
  A focused, actionable to-do list from Canvas, sorted by urgency. Use when the
  student asks "what's due", "what do I need to turn in", "am I missing
  anything", "what's my to-do list", or "what's due today/tomorrow". Requires
  the canvas-scholar-mcp server.
---

# Canvas student to-do

Produce a tight, do-this-now list — not a calendar.

## Steps

1. Call `canvas_get_missing_submissions` — these are the highest priority.
2. Call `canvas_get_planner_items` for the dated near-term items.
3. Optionally call `canvas_get_todo` for Canvas's own action list, and de-duplicate against the above.
4. Sort into **Missing**, **Due today**, **Due this week**. Drop anything already submitted/graded.

## Output template

```
## To-do

**🔴 Missing (turn in ASAP)**
- [ ] <Course> — <Assignment> (was due <date>)

**🟠 Due today**
- [ ] <Course> — <Assignment> (<time>)

**🟡 Due this week**
- [ ] <Course> — <Assignment> (<date>)
```

Keep it to a checklist. If a submission type matters (file upload, quiz), note
it in one word. Offer to open any item's details or rubric on request.
