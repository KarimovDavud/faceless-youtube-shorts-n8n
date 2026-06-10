# Architecture & Design Notes

This document explains *how* the pipeline works and *why* each choice was made — the part
that turns a working demo into a portfolio piece.

## The flow

```
Daily Schedule ─▶ Build Prompt ─▶ Generate Script (Groq) ─▶ Parse Script
      └─▶ Build Job ─▶ Produce Video (produce.sh) ─▶ Read Video File ─▶ Upload to YouTube
```

Each n8n node owns one responsibility; the heavy media work is delegated to a single shell
script (`produce.sh`) that runs *inside the same container*.

### Node by node

| Node | Type | Responsibility |
|---|---|---|
| **Daily Schedule** | Schedule Trigger | Fires the workflow once per day at a fixed hour. |
| **Build Prompt** | Code | Constructs the Groq request body (system prompt + params). Keeping the prompt in a Code node makes it readable and version-controllable. |
| **Generate Script (Groq)** | HTTP Request | Calls Groq's OpenAI-compatible endpoint. `response_format: json_object` forces structured output. Auth via `$env.GROQ_API_KEY`. |
| **Parse Script** | Code | Parses the LLM JSON, validates required fields, normalises defaults. Fails loudly with the raw text if the model misbehaves. |
| **Build Job** | Code | Mints a per-run id (`$execution.id`), packs `{script, query, voice}` into a base64 payload — base64 sidesteps all shell-escaping issues when the text reaches `produce.sh`. |
| **Produce Video** | Execute Command | Writes `job.json`, then runs `produce.sh` (tts → background → ffmpeg). |
| **Read Video File** | Read/Write File | Loads the rendered `video.mp4` from disk into n8n binary data. |
| **Upload to YouTube** | YouTube | Uploads via the Data API with OAuth2, using the title/description/tags from the script. |

## Key design decisions

**Why self-hosted n8n + a custom image?**
The free, high-quality pieces of this pipeline (`ffmpeg`, `edge-tts`) are command-line tools.
n8n Cloud can't shell out to them, so we bake them into our own image
([`Dockerfile`](../Dockerfile)) and call them with the **Execute Command** node. This is the
single decision that makes the whole thing free.

**Why `edge-tts` over ElevenLabs/PlayHT?**
ElevenLabs is great but metered. `edge-tts` exposes Microsoft's Neural voices for free with
**no API key** and — crucially — emits a **word-synced subtitle file** (`subs.vtt`) we burn
straight into the video. Synced captions are the single biggest retention lever on Shorts.

**Why a base64 job payload instead of command-line args?**
LLM output contains quotes, apostrophes, newlines — anything that breaks naive shell
interpolation or risks command injection. Encoding the payload to base64 in **Build Job** and
decoding it inside the container (`base64 -d > job.json`) is bulletproof and keeps the
Execute Command line trivial.

**Why one `produce.sh` instead of many media nodes?**
Juggling binary blobs (audio, video) between many n8n nodes is fragile and memory-heavy.
A single script that works against known file paths in a per-run folder is easier to test in
isolation (`docker exec ... /scripts/produce.sh /data/manual-test`), reason about, and port.

**Why `privacyStatus: private` by default?**
So a misfire never ships junk to a public channel. You promote to `public` only after you've
watched a few renders.

## The ffmpeg compose step

```
[bg] scale to cover 1080×1920 ─▶ crop to exact 9:16 ─▶ dim slightly (-0.06 brightness)
                                      │
[subs.vtt] ──────────── burn captions (centered, bold, outlined) ─▶ [v]
[voice.mp3] ─────────────────────────────────────────────────────▶ audio
                                      ▼
                         libx264 + aac, +faststart, -shortest ─▶ video.mp4
```

- `force_original_aspect_ratio=increase` + `crop` guarantees a clean fill regardless of the
  source clip's dimensions.
- `-stream_loop -1 ... -shortest` loops a short background to cover the narration length.
- `+faststart` moves the moov atom to the front so the upload streams/plays immediately.
- Caption styling lives in one `force_style` string — the obvious place to tune the look.

## Extending it

- **Different platform:** swap **Upload to YouTube** for an Instagram/TikTok upload node or
  HTTP call; the rendered `video.mp4` is platform-agnostic 9:16.
- **Background music:** drop an `.mp3` in `assets/` and add a third ffmpeg input mixed under
  the voice with `amix`/`volume`.
- **Multiple niches:** branch after **Build Prompt** with different system prompts, or pick a
  niche at random in the Code node.
- **Human-in-the-loop:** insert an approval (Wait + webhook, Telegram, or email) between
  **Produce Video** and **Upload to YouTube**.
- **Thumbnails / B-roll variety:** have the LLM emit multiple `query` terms and concatenate
  several Pexels clips for visual variety.
```
