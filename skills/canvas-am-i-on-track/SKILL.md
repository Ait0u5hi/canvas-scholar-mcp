---
name: canvas-am-i-on-track
description: >-
  Check how the student is doing gradewise across all courses and flag anything
  slipping. Use when the student asks "how are my grades", "am I on track",
  "what's my GPA looking like", "which class should I worry about", or "am I
  passing everything". Requires the canvas-scholar-mcp server.
---

# Am I on track?

Give an honest, encouraging read on where grades stand — and what would move them.

## Steps

1. Call `canvas_get_grades` for the current grade in every active course.
2. For any course that looks low or has `null`/`0` scores, call `canvas_get_course_grade` and `canvas_get_assignment_groups` to see the weighted breakdown (which categories are dragging, what's still ungraded).
3. Call `canvas_get_missing_submissions` — missing work is usually the real cause.
4. Flag any course below the student's threshold (ask if unknown; default: below B / 80%).

## Output template

```
## Grade check

| Course | Current | Status |
|---|---|---|
| <name> | <grade> | ✅ on track / ⚠️ watch / 🔴 at risk |

**Worth your attention**
- <Course> (<grade>): <why — e.g. "2 missing assignments in the 40%-weighted Homework group">. Turning in <X> would help most.

**Note on ungraded courses**
- A `0` final with a `null` current score usually just means nothing's been graded yet — not a real zero.
```

Be honest but not alarmist. Always tie a low grade to a concrete next action.
Never invent numbers — if a score is null/ungraded, say so.
