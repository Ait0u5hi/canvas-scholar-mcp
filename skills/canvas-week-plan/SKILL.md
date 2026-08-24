---
name: canvas-week-plan
description: >-
  Build a prioritized plan for the week ahead from Canvas — what's due, what's
  missing, and how your grades stand. Use when the student asks "plan my week",
  "what's coming up", "what do I need to do this week", "help me get organized",
  or "what's on my plate". Requires the canvas-scholar-mcp server.
---

# Canvas week plan

Turn a student's Canvas data into one prioritized weekly view.

## Steps

1. Call `canvas_list_courses` to get the active courses (for names/ids).
2. Call `canvas_get_planner_items` (default window is the next ~2 weeks) for everything with a date.
3. Call `canvas_get_missing_submissions` to catch anything already overdue.
4. Call `canvas_get_grades` so you can flag courses that need attention.
5. Call `canvas_list_conferences` for live class sessions (BigBlueButton, etc.) — these do NOT come back from the calendar or planner, so skipping this misses your own class meetings. Also check `canvas_list_calendar_events` for recurring events like Teams meetings.
6. Merge and sort by due date. Group into **Overdue**, **Due this week**, **Live sessions / meetings**, **Next week**, and **Heads-up (grades)**.

## Output template

```
## Your week at a glance

### ⚠️ Overdue — do first
- <Course>: <Assignment> (was due <date>)

### 📌 Due this week
- <Mon–Sun>: <Course> — <Assignment> (due <date>, <points> pts)

### 🎥 Live sessions / meetings
- <Course> — <session> (<date/time>, join: <link>)

### 🔭 Next week
- <Course> — <Assignment> (due <date>)

### 📊 Grade watch
- <Course>: <current grade> — <one-line why it matters, if low>
```

If nothing is overdue, say so plainly. Keep it scannable; don't dump raw JSON.
Offer to pull the full details or rubric for any single item with
`canvas_get_assignment` / `canvas_get_submission_feedback`.
