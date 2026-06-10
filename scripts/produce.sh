#!/usr/bin/env bash
# ===========================================================================
# produce.sh — the media engine for the YouTube Shorts pipeline.
#
# Called by the n8n "Produce Video" (Execute Command) node as:
#     /scripts/produce.sh <RUN_DIR>
#
# It expects <RUN_DIR>/job.json to already exist, shaped like:
#     { "script": "...", "query": "ocean", "voice": "en-US-AriaNeural" }
#
# Steps:
#   1. edge-tts  -> voice.mp3 + subs.vtt (word-synced captions, FREE, no key)
#   2. Pexels    -> bg.mp4 (vertical stock clip; falls back to a gradient)
#   3. ffmpeg    -> video.mp4 (crop to 1080x1920, burn captions, mux audio)
#
# On success it prints a one-line JSON summary to stdout.
# ===========================================================================
set -euo pipefail

RUN_DIR="${1:?Usage: produce.sh <RUN_DIR>}"
JOB="$RUN_DIR/job.json"
[ -s "$JOB" ] || { echo "ERROR: $JOB missing" >&2; exit 1; }

SCRIPT_TEXT=$(jq -r '.script'              "$JOB")
QUERY=$(jq -r '.query // "abstract"'       "$JOB")
VOICE=$(jq -r '.voice // "en-US-AriaNeural"' "$JOB")

VOICE_MP3="$RUN_DIR/voice.mp3"
SUBS="$RUN_DIR/subs.vtt"
BG="$RUN_DIR/bg.mp4"
OUT="$RUN_DIR/video.mp4"

# ---------------------------------------------------------------------------
# 1) Voiceover + word-synced subtitles
# ---------------------------------------------------------------------------
printf '%s' "$SCRIPT_TEXT" > "$RUN_DIR/script.txt"

edge-tts \
  --voice "$VOICE" \
  --rate="+6%" \
  --file "$RUN_DIR/script.txt" \
  --write-media "$VOICE_MP3" \
  --write-subtitles "$SUBS"

# ---------------------------------------------------------------------------
# 2) Background: vertical Pexels clip, or an ffmpeg gradient fallback
# ---------------------------------------------------------------------------
PEXELS_KEY="${PEXELS_API_KEY:-}"
if [ -n "$PEXELS_KEY" ]; then
  ENC_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)
  VIDEO_URL=$(curl -fsS -H "Authorization: $PEXELS_KEY" \
    "https://api.pexels.com/videos/search?query=${ENC_QUERY}&orientation=portrait&size=medium&per_page=20" \
    | jq -r '[.videos[].video_files[] | select(.height>=1280 and .width<=1200)][0].link // empty' || true)
  if [ -n "$VIDEO_URL" ]; then
    curl -fsSL "$VIDEO_URL" -o "$BG" || true
  fi
fi

if [ ! -s "$BG" ]; then
  echo "INFO: no Pexels clip, generating gradient background" >&2
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "gradients=s=1080x1920:d=60:c0=0x0f2027:c1=0x2c5364:c2=0x203a43" \
    -t 60 -pix_fmt yuv420p "$BG"
fi

# ---------------------------------------------------------------------------
# 3) Compose: crop to 9:16, slight dim, burn big centered captions, mux audio
# ---------------------------------------------------------------------------
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VOICE_MP3")

CAPTION_STYLE="FontName=DejaVu Sans,Fontsize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&HC8000000,BorderStyle=1,Outline=4,Shadow=1,Alignment=2,MarginV=300"

ffmpeg -y -hide_banner -loglevel error \
  -stream_loop -1 -i "$BG" \
  -i "$VOICE_MP3" \
  -t "$DUR" \
  -filter_complex "\
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,eq=brightness=-0.06[bg];\
[bg]subtitles='${SUBS}':force_style='${CAPTION_STYLE}'[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  -shortest \
  "$OUT"

# ---------------------------------------------------------------------------
# Done — emit a summary the n8n node can read from stdout.
# ---------------------------------------------------------------------------
echo "{\"video\":\"${OUT}\",\"duration\":${DUR},\"background\":\"$( [ -n "${VIDEO_URL:-}" ] && echo pexels || echo gradient )\"}"
