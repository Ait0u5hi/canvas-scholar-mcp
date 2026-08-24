#!/usr/bin/env node
/**
 * transcribe-lecture — turn a Canvas/BigBlueButton lecture recording into a text
 * transcript you can read, search, or feed to an LLM.
 *
 * This is a COMPANION utility, intentionally separate from the MCP server: the
 * server stays read-only and JSON-only, while this does the heavy media work.
 *
 *   node scripts/transcribe-lecture.mjs <recording-url> [--out file.txt]
 *
 * Pipeline:  recording URL → find the media asset → download → ffmpeg (16k mono
 * wav) → whisper → transcript.
 *
 * Requirements (must be on PATH):
 *   - ffmpeg
 *   - a whisper CLI: whisper.cpp (`whisper-cli`/`main`, needs WHISPER_MODEL) or
 *     OpenAI `whisper`. Override with WHISPER_CMD.
 *
 * Env:
 *   WHISPER_CMD    whisper binary (default: auto-detect whisper-cli, main, whisper)
 *   WHISPER_MODEL  ggml model path for whisper.cpp (e.g. models/ggml-base.en.bin)
 *   FFMPEG_CMD     ffmpeg binary (default: ffmpeg)
 *
 * Options:
 *   --media-url <url>  direct audio/video URL (skip BBB asset probing)
 *   --out <path>       transcript output path
 *   --keep             keep the downloaded/intermediate media files
 *
 * Note: BigBlueButton has no official "download recording" API; recording asset
 * layouts vary by host. This probes the standard BBB "presentation" asset paths;
 * if your host differs, open the playback page, find the media in your browser's
 * network tab, and pass it with --media-url.
 *
 * Consent: lecture recordings include your instructor's and classmates' voices.
 * Transcribe for your OWN study. Do not redistribute transcripts or feed other
 * people's contributions into shared/training corpora.
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep") args.keep = true;
    else if (a === "--media-url") args.mediaUrl = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else args._.push(a);
  }
  return args;
}

function have(cmd) {
  const probe = spawnSync(cmd, ["--help"], { stdio: "ignore" });
  return !probe.error;
}

function die(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

/** Candidate BBB "presentation" recording assets, best audio source first. */
function bbbCandidates(url) {
  const host = safeHost(url);
  if (!host) return [];
  // Grab the longest id-looking token from the path (BBB meeting/recording id).
  const idMatch = url.match(/[a-f0-9]{40,}(?:-\d+)?/i) || url.match(/[a-f0-9-]{20,}/i);
  if (!idMatch) return [];
  const id = idMatch[0];
  const base = `https://${host}/presentation/${id}`;
  return [
    `${base}/video/webcams.webm`, // has audio
    `${base}/audio/audio.opus`,
    `${base}/audio/audio.ogg`,
    `${base}/deskshare/deskshare.webm`,
  ];
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function firstReachable(urls) {
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: "GET", headers: { Range: "bytes=0-1" } });
      if (res.ok || res.status === 206) {
        res.body?.cancel?.();
        return u;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) die(`download failed: HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) die(`${cmd} not found on PATH (${r.error.message})`);
  if (r.status !== 0) die(`${cmd} exited with code ${r.status}`);
}

function resolveWhisper() {
  if (process.env.WHISPER_CMD) return process.env.WHISPER_CMD;
  for (const c of ["whisper-cli", "main", "whisper"]) if (have(c)) return c;
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input && !args.mediaUrl) {
    die(
      "usage: node scripts/transcribe-lecture.mjs <recording-url> [--media-url <url>] [--out file.txt] [--keep]",
    );
  }

  const ffmpeg = process.env.FFMPEG_CMD || "ffmpeg";
  if (!have(ffmpeg)) die(`ffmpeg not found (set FFMPEG_CMD). Install ffmpeg and retry.`);
  const whisper = resolveWhisper();
  if (!whisper)
    die(
      "no whisper CLI found. Install whisper.cpp (whisper-cli/main + set WHISPER_MODEL) " +
        "or OpenAI whisper, or set WHISPER_CMD.",
    );

  // 1. Resolve the media URL.
  let mediaUrl = args.mediaUrl;
  if (!mediaUrl) {
    console.error("• locating recording media …");
    const candidates = bbbCandidates(input);
    mediaUrl = candidates.length ? await firstReachable(candidates) : null;
    if (!mediaUrl) {
      die(
        "couldn't auto-locate the media for this recording.\n" +
          "  Open the playback page in a browser, find the audio/video request in the\n" +
          "  Network tab (e.g. webcams.webm or audio.opus), and re-run with:\n" +
          `    node scripts/transcribe-lecture.mjs "${input}" --media-url "<that URL>"`,
      );
    }
  }
  console.error(`• media: ${mediaUrl}`);

  const work = await mkdtemp(join(tmpdir(), "lecture-"));
  const mediaFile = join(work, "media");
  const wavFile = join(work, "audio.wav");
  const out = args.out || `transcript-${slug(input || mediaUrl)}.txt`;

  try {
    // 2. Download.
    console.error("• downloading …");
    await download(mediaUrl, mediaFile);

    // 3. Normalize to 16 kHz mono wav (what whisper wants).
    console.error("• extracting audio (ffmpeg) …");
    run(ffmpeg, ["-y", "-i", mediaFile, "-ar", "16000", "-ac", "1", wavFile]);

    // 4. Transcribe.
    console.error(`• transcribing (${whisper}) …`);
    const txt = transcribe(whisper, wavFile, work);

    await writeFile(out, txt, "utf8");
    console.error(`\n✓ transcript written to ${out} (${txt.length} chars)`);
  } finally {
    if (!args.keep) await rm(work, { recursive: true, force: true });
  }
}

/** Drive whichever whisper we found; return the transcript text. */
function transcribe(cmd, wav, work) {
  const base = /whisper-cli|(^|[\\/])main$/.test(cmd) || process.env.WHISPER_MODEL;
  if (base) {
    // whisper.cpp style
    const model = process.env.WHISPER_MODEL;
    if (!model)
      die("whisper.cpp needs a model: set WHISPER_MODEL=/path/to/ggml-*.bin");
    const outBase = join(work, "out");
    run(cmd, ["-m", model, "-f", wav, "-otxt", "-of", outBase]);
    return readFileSyncSafe(`${outBase}.txt`);
  }
  // OpenAI whisper style
  run(cmd, [wav, "--model", "base", "--output_format", "txt", "--output_dir", work]);
  return readFileSyncSafe(join(work, "audio.txt"));
}

function readFileSyncSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    die(`transcription produced no output at ${p}`);
  }
}

function slug(s) {
  return (
    String(s)
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lecture"
  );
}

main().catch((e) => die(e.message));
