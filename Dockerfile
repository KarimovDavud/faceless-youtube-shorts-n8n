# The official n8n image is now a "Docker Hardened Image" with NO package
# manager, so we can't add ffmpeg/edge-tts to it. Instead we build n8n on a
# normal Node base and install the whole media toolchain ourselves.
#
#   - n8n            (via npm, global)
#   - ffmpeg/ffprobe (apt)            -> rendering
#   - edge-tts       (pip, in a venv) -> free Microsoft Neural TTS + subtitles
#   - jq, curl       (apt)            -> JSON + downloads in produce.sh
#   - DejaVu font    (apt)            -> burned captions
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-venv \
        python3-pip \
        jq \
        curl \
        ca-certificates \
        tini \
        fonts-dejavu-core \
    # edge-tts in an isolated venv (Debian blocks global pip via PEP 668)
    && python3 -m venv /opt/tts \
    && /opt/tts/bin/pip install --no-cache-dir edge-tts \
    && ln -sf /opt/tts/bin/edge-tts /usr/local/bin/edge-tts \
    # n8n itself
    && npm install -g n8n --omit=dev \
    && npm cache clean --force \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Media engine + runtime dirs
COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh \
    && mkdir -p /data /home/node/.n8n \
    && chown -R node:node /data /home/node/.n8n /scripts

USER node
ENV N8N_USER_FOLDER=/home/node/.n8n
WORKDIR /home/node
EXPOSE 5678

# tini reaps the ffmpeg/edge-tts child processes the Execute Command node spawns.
ENTRYPOINT ["tini", "--"]
CMD ["n8n", "start"]
