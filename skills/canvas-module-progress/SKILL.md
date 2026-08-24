---
name: canvas-module-progress
description: >-
  Show how far along the student is in a course's modules and what's unlocked
  next. Use when the student asks "where am I in the course", "what's next in
  <course>", "what modules are left", "am I caught up", or "what should I work
  on next in <course>". Requires the canvas-scholar-mcp server.
---

# Module progress

Walk a course's modules to show what's done, what's next, and what's still locked.

## Steps

1. Identify the course (call `canvas_list_courses` for the id if needed).
2. Call `canvas_list_modules` for that course (it includes the items).
3. Read each module/item's `state` and `completion_requirement` to classify: completed, in-progress, unlocked-not-started, or locked.
4. Point the student at the next actionable item. If an item links an assignment or page, offer to open it (`canvas_get_assignment`, `canvas_get_course_page`).

## Output template

```
## <Course> — module progress

**Overall:** <X of Y modules complete>

- ✅ <Module>: done
- ⏳ <Module>: in progress — next up: <item> (<type>)
- 🔓 <Module>: unlocked, not started
- 🔒 <Module>: locked (needs <requirement>)

**Do next:** <the single next actionable item, with why>
```

If the course doesn't use modules (empty result), say so and suggest the
planner or assignments view instead. Don't imply progress the data doesn't show.
