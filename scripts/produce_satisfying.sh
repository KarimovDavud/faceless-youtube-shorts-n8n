#!/usr/bin/env bash
# ===========================================================================
# produce_satisfying.sh — "oddly satisfying" transformation Shorts engine.
#
# No narration. Stitches several real Pexels stock clips that tell a
# start->finished transformation (pool build, house construction, garden
# landscaping, deep cleaning, etc.), adds an on-screen hook caption and a
# soft ambient audio bed.
#
# Called as:  produce_satisfying.sh <RUN_DIR>
# Expects <RUN_DIR>/job.json:
#   { "queries": ["excavator digging","pool construction",...],
#     "hook": "Building a Dream Pool", "per": 6 }
# ===========================================================================
set -euo pipefail

RUN_DIR="${1:?Usage: produce_satisfying.sh <RUN_DIR>}"
JOB="$RUN_DIR/job.json"
[ -s "$JOB" ] || { echo "ERROR: $JOB missing" >&2; exit 1; }

PER=$(jq -r '.per // 6' "$JOB")
HOOK=$(jq -r '.hook // ""' "$JOB")
PEXELS_KEY="${PEXELS_API_KEY:?PEXELS_API_KEY required for satisfying mode}"
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT="$RUN_DIR/video.mp4"

mapfile -t QUERIES < <(jq -r '.queries[]' "$JOB")
[ "${#QUERIES[@]}" -gt 0 ] || { echo "ERROR: no queries in job.json" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1) Fetch + normalize one portrait clip per query
# ---------------------------------------------------------------------------
i=0
PARTS=()
for Q in "${QUERIES[@]}"; do
  ENC=$(printf '%s' "$Q" | jq -sRr @uri)
  # collect candidate portrait links, pick one (vary by index for diversity)
  LINKS=$(curl -fsS -H "Authorization: $PEXELS_KEY" \
    "https://api.pexels.com/videos/search?query=${ENC}&orientation=portrait&size=medium&per_page=15" \
    | jq -r '[.videos[].video_files[] | select(.height>=1200 and .width<=1200)] | .[].link' 2>/dev/null || true)
  [ -n "$LINKS" ] || { echo "INFO: no clip for '$Q', skipping" >&2; continue; }
  PICK=$(printf '%s\n' "$LINKS" | sed -n "$(( (i % 3) + 1 ))p")
  [ -n "$PICK" ] || PICK=$(printf '%s\n' "$LINKS" | head -1)

  RAW="$RUN_DIR/raw_$i.mp4"
  curl -fsSL --max-time 90 "$PICK" -o "$RAW" || { echo "INFO: download failed for '$Q'" >&2; continue; }

  PART="$RUN_DIR/part_$i.mp4"
  # crop to 9:16, fixed length, 30fps, drop audio, slow zoom for a 'satisfying' feel
  if ffmpeg -y -hide_banner -loglevel error -i "$RAW" -t "$PER" \
       -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p" \
       -an -c:v libx264 -preset veryfast -crf 23 "$PART" 2>/dev/null; then
    PARTS+=("$PART")
    i=$((i+1))
  else
    echo "INFO: normalize failed for '$Q'" >&2
  fi
done

[ "${#PARTS[@]}" -ge 2 ] || { echo "ERROR: not enough usable clips (${#PARTS[@]})" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 2) Concatenate the normalized parts
# ---------------------------------------------------------------------------
: > "$RUN_DIR/list.txt"
for p in "${PARTS[@]}"; do echo "file '$p'" >> "$RUN_DIR/list.txt"; done
CONCAT="$RUN_DIR/concat.mp4"
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$RUN_DIR/list.txt" -c copy "$CONCAT" 2>/dev/null \
  || ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$RUN_DIR/list.txt" \
       -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p "$CONCAT"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CONCAT")

# ---------------------------------------------------------------------------
# 3) Hook caption (optional) + soft ambient bed -> final video
# ---------------------------------------------------------------------------
# ambient: brown noise, heavily low-passed = calm airy bed; fades in/out
AUDIO_FILTER="lowpass=f=400,volume=0.35,afade=t=in:d=1.5,afade=t=out:st=$(awk "BEGIN{print $DUR-1.5}"):d=1.5"

if [ -n "$HOOK" ]; then
  printf '%s' "$HOOK" > "$RUN_DIR/hook.txt"
  VIDEO_FILTER="[0:v]drawtext=textfile=$RUN_DIR/hook.txt:fontfile=$FONT:fontsize=58:fontcolor=white:borderw=3:bordercolor=black@0.85:box=1:boxcolor=black@0.35:boxborderw=22:x=(w-text_w)/2:y=170[v]"
  MAPV="[v]"
else
  VIDEO_FILTER="[0:v]copy[v]"
  MAPV="[v]"
fi

ffmpeg -y -hide_banner -loglevel error \
  -i "$CONCAT" \
  -f lavfi -t "$DUR" -i "anoisesrc=color=brown:amplitude=0.08:sample_rate=44100" \
  -filter_complex "${VIDEO_FILTER};[1:a]${AUDIO_FILTER}[a]" \
  -map "$MAPV" -map "[a]" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart -shortest \
  "$OUT"

echo "{\"video\":\"${OUT}\",\"duration\":${DUR},\"clips\":${#PARTS[@]}}"
