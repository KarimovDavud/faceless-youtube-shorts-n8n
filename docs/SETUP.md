# Setup Guide

From zero to an automated channel in ~15 minutes. You need: Docker Desktop, a Google
account (for the YouTube channel), a free Groq key, and optionally a free Pexels key.

---

## 1. Get your free API keys

### Groq (writes the script) — required
1. Go to **https://console.groq.com/keys** and sign in.
2. **Create API Key**, copy it (`gsk_...`).

### Pexels (background footage) — optional but recommended
1. Go to **https://www.pexels.com/api/**, sign in, **Your API Key**.
2. Copy it. *(If you skip this, videos use an auto-generated gradient background.)*

> `edge-tts` (the voice) needs **no key** — it's free Microsoft Neural TTS.

---

## 2. Configure & launch

```bash
cd youtube-shorts-automation
cp .env.example .env
# edit .env -> paste GROQ_API_KEY and (optionally) PEXELS_API_KEY
docker compose up -d --build
```

First build takes a few minutes (it installs ffmpeg + edge-tts into the image).
When it's done, open **http://localhost:5678** and create the n8n owner account.

Sanity-check the toolchain is inside the container:

```bash
docker exec n8n-shorts ffmpeg -version | head -1
docker exec n8n-shorts edge-tts --list-voices | head -3
```

---

## 3. Connect YouTube (OAuth2)

This is the only step that needs Google Cloud. n8n stores it as a **credential**.

1. **Google Cloud Console** → create a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, fill the app name/email.
   - Add scope `.../auth/youtube.upload` (and `youtube.readonly`).
   - Add your Google account under **Test users** (keeps it in testing mode, that's fine).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type **Web application**.
   - **Authorized redirect URI**: copy the exact URL n8n shows you in step 6 below,
     typically `http://localhost:5678/rest/oauth2-credential/callback`.
   - Save the **Client ID** and **Client secret**.
5. In **n8n**: **Credentials → New → "YouTube OAuth2 API"**.
6. Paste the Client ID + secret, copy n8n's redirect URL back into Google (step 4) if you
   hadn't yet, then click **Connect / Sign in with Google** and authorize.

---

## 4. Import & run the workflow

1. In n8n: **Workflows → Import from File** → select
   `workflows/youtube-shorts-automation.json`.
2. Open the **Upload to YouTube** node → set its credential to the YouTube account you
   just connected.
3. Click **Test workflow** (top bar). Watch it run: script → voice → render → upload.
4. Check your channel — a new **private** video appears. Watch it. Happy? 🎉

### Go live
- In **Upload to YouTube** change `privacyStatus` from `private` → `public`.
- Open **Daily Schedule** and set your posting hour (it's `14:00` in your `TIMEZONE`).
- Toggle the workflow **Active** (top-right). It now posts automatically every day.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `Generate Script` 401 | `GROQ_API_KEY` missing/typo in `.env`. `docker compose up -d` after editing. |
| LLM JSON parse error | Groq occasionally wraps output; just re-run. The Parse node reports the raw text. |
| `Produce Video` fails: `edge-tts: not found` | Rebuild the image: `docker compose up -d --build`. |
| No audio / 0-byte voice | The script text was empty — check the Groq output in *Parse Script*. |
| Background always gradient | `PEXELS_API_KEY` empty, rate-limited, or the query found no portrait clip. |
| YouTube upload 403 `quotaExceeded` | Daily upload quota; YouTube Data API allows ~6 uploads/day by default. |
| YouTube 401 / token expired | Reconnect the OAuth2 credential in n8n. |
| Files not appearing in `./data` | On Windows, ensure the drive is shared in Docker Desktop → Settings → Resources. |

### Inspecting a run by hand

```bash
# list run folders the pipeline created
docker exec n8n-shorts ls -la /data
# pull a rendered video out to inspect locally
docker cp n8n-shorts:/data/<runId>/video.mp4 ./video.mp4
```
