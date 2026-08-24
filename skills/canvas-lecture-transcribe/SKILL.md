---
name: canvas-lecture-transcribe
description: >-
  Find a Canvas lecture recording and turn it into a text transcript you can
  read, search, or study from. Use when the student asks "transcribe my
  lecture", "get the transcript of last class", "I missed class, can I read what
  was said", "turn the recording into notes", or "summarize the lecture
  recording". Requires the canvas-scholar-mcp server AND the companion
  transcribe-lecture script (ffmpeg + a whisper CLI installed).
---

# Canvas lecture transcribe

Locate a class recording via Canvas, then run the companion script to transcribe
it. The MCP server only *finds* the recording; the script does the download +
transcription (it's heavy media work kept out of the read-only server).

## Steps

1. Identify the course (call `canvas_list_courses` for the id if needed).
2. Call `canvas_list_conferences(courseId)` and find the session the student
   means. Look for a recording with `show_to_students: true` and a playback URL
   (`recording_url` / `playback` / a `.../presentation/...` or `.../capture/`
   link). If the session is still live or the recording hasn't processed yet,
   tell the student it isn't ready.
3. Run the companion script with that URL:
   ```
   node scripts/transcribe-lecture.mjs "<recording playback URL>" --out lecture.txt
   ```
   If it can't auto-locate the media, tell the student to open the playback page,
   find the audio/video request in their browser's Network tab, and re-run with
   `--media-url "<that URL>"`.
4. Read the resulting transcript file and do what the student asked — summarize,
   pull key points, make study notes, or answer questions from it.

## Prerequisites (tell the student if missing)

- `ffmpeg` on PATH.
- A whisper CLI: whisper.cpp (`whisper-cli`/`main` + `WHISPER_MODEL=/path/ggml-*.bin`)
  or OpenAI `whisper`. Override with `WHISPER_CMD`.

## Consent note

Lecture recordings include the instructor's and classmates' voices. Transcribe
for the student's **own** study. Do not redistribute the transcript or feed other
people's contributions into shared or training corpora.
