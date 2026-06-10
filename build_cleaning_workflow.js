// Builds the CLEANING "satisfying" workflow (car / house cleaning transformations).
// Output: workflows/cleaning-automation.json  + a manual deploy variant.
// Reuses the already-connected YouTube credential.
const fs = require('fs');
const path = require('path');

const YT_CRED_ID = 'wnouvKf8iUYC3etp';   // existing connected "YouTube account" credential
const YT_CRED_NAME = 'YouTube account';

const systemPrompt = [
  "You produce 'oddly satisfying' CLEANING transformation Shorts. No narration, no voiceover.",
  "Each video is EITHER a CAR cleaning/detailing transformation OR a HOUSE/room deep-clean",
  "transformation, shown from dirty/messy to spotless. Return ONLY a JSON object with keys:",
  "",
  "  theme       - 'car' or 'house'.",
  "  title       - <= 90 chars, satisfying & curiosity-driven, may use 1-2 emojis,",
  "                MUST end with ' #Shorts'. e.g. 'Deep Cleaning the DIRTIEST Car Ever 🚗 #Shorts'.",
  "  description - 2 short sentences, then a new line with 5 hashtags",
  "                (always include #satisfying #cleaning #asmr).",
  "  tags        - array of 8-12 lowercase keyword strings.",
  "  hook        - <= 28 chars ON-SCREEN caption, PLAIN ASCII text, NO emojis, NO punctuation",
  "                that needs escaping. e.g. 'Deep Clean Transformation' or 'Filthy Car Reborn'.",
  "  queries     - array of EXACTLY 5 short stock-video search phrases that tell the cleaning",
  "                progression from dirty to clean. They must be concrete things stock sites have.",
  "                CAR example: ['dirty car interior','car vacuum cleaning','car wash foam',",
  "                'car detailing polish','clean shiny car'].",
  "                HOUSE example: ['messy room','vacuuming carpet','mopping floor',",
  "                'wiping kitchen counter','clean tidy living room'].",
  "",
  "Alternate between car and house across videos. Keep queries simple and literal."
].join("\n");

const buildPromptCode = [
  "const system = " + JSON.stringify(systemPrompt) + ";",
  "const body = {",
  "  model: 'llama-3.3-70b-versatile',",
  "  temperature: 1.0,",
  "  response_format: { type: 'json_object' },",
  "  messages: [",
  "    { role: 'system', content: system },",
  "    { role: 'user', content: 'Generate ONE fresh cleaning Short now. Respond with the JSON object only.' }",
  "  ]",
  "};",
  "return [{ json: { body } }];"
].join("\n");

const parseScriptCode = [
  "const res = $input.first().json;",
  "const content = res.choices && res.choices[0] && res.choices[0].message.content;",
  "if (!content) throw new Error('No content from LLM: ' + JSON.stringify(res).slice(0,400));",
  "let d; try { d = JSON.parse(content); } catch(e){ throw new Error('Bad LLM JSON: ' + content.slice(0,400)); }",
  "if (!d.title) throw new Error('missing title');",
  "d.queries = Array.isArray(d.queries) ? d.queries.filter(Boolean) : [];",
  "if (d.queries.length < 3) throw new Error('need >=3 queries, got ' + d.queries.length);",
  "d.hook = (d.hook || '').replace(/[^\\x20-\\x7E]/g, '').slice(0, 28);",
  "d.tags = Array.isArray(d.tags) ? d.tags : [];",
  "return [{ json: d }];"
].join("\n");

const buildJobCode = [
  "const item = $input.first().json;",
  "const runId = String($execution.id || Date.now());",
  "const runDir = `/data/${runId}`;",
  "const job = { hook: item.hook || '', per: 6, queries: item.queries };",
  "const jobB64 = Buffer.from(JSON.stringify(job), 'utf8').toString('base64');",
  "return [{ json: { runId, runDir, jobB64, title: item.title, description: item.description, tags: item.tags } }];"
].join("\n");

const produceCommand =
  "mkdir -p {{ $json.runDir }} && " +
  "echo '{{ $json.jobB64 }}' | base64 -d > {{ $json.runDir }}/job.json && " +
  "bash /scripts/produce_satisfying.sh {{ $json.runDir }}";

function coreNodes() {
  return [
    { parameters: { jsCode: buildPromptCode }, id: "c-buildprompt", name: "Build Prompt", type: "n8n-nodes-base.code", typeVersion: 2, position: [180, 300] },
    { parameters: {
        method: "POST", url: "https://api.groq.com/openai/v1/chat/completions",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.GROQ_API_KEY }}" },
          { name: "Content-Type", value: "application/json" } ] },
        sendBody: true, specifyBody: "json", jsonBody: "={{ $json.body }}", options: { timeout: 60000 }
      }, id: "c-groq", name: "Generate Script (Groq)", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [440, 300] },
    { parameters: { jsCode: parseScriptCode }, id: "c-parse", name: "Parse Script", type: "n8n-nodes-base.code", typeVersion: 2, position: [700, 300] },
    { parameters: { jsCode: buildJobCode }, id: "c-buildjob", name: "Build Job", type: "n8n-nodes-base.code", typeVersion: 2, position: [960, 300] },
    { parameters: { command: "=" + produceCommand }, id: "c-produce", name: "Produce Video", type: "n8n-nodes-base.executeCommand", typeVersion: 1, position: [1220, 300] },
    { parameters: { operation: "read", fileSelector: "={{ $('Build Job').item.json.runDir }}/video.mp4", options: {} }, id: "c-read", name: "Read Video File", type: "n8n-nodes-base.readWriteFile", typeVersion: 1, position: [1480, 300] },
    { parameters: {
        resource: "video", operation: "upload",
        title: "={{ $('Parse Script').item.json.title }}",
        regionCode: "AZ", categoryId: "26", binaryProperty: "data",
        options: {
          description: "={{ $('Parse Script').item.json.description }}",
          privacyStatus: "public",
          tags: "={{ ($('Parse Script').item.json.tags || []).join(',') }}"
        }
      }, id: "c-youtube", name: "Upload to YouTube", type: "n8n-nodes-base.youTube", typeVersion: 1, position: [1740, 300],
      credentials: { youTubeOAuth2Api: { id: YT_CRED_ID, name: YT_CRED_NAME } } }
  ];
}

const baseConns = {
  "Build Prompt":            { main: [[{ node: "Generate Script (Groq)", type: "main", index: 0 }]] },
  "Generate Script (Groq)":  { main: [[{ node: "Parse Script",           type: "main", index: 0 }]] },
  "Parse Script":            { main: [[{ node: "Build Job",              type: "main", index: 0 }]] },
  "Build Job":               { main: [[{ node: "Produce Video",          type: "main", index: 0 }]] },
  "Produce Video":           { main: [[{ node: "Read Video File",        type: "main", index: 0 }]] },
  "Read Video File":         { main: [[{ node: "Upload to YouTube",      type: "main", index: 0 }]] }
};

// --- scheduled workflow ---
const scheduled = {
  id: "cleaningautopost",
  name: "YouTube Shorts — Cleaning (Automated)",
  active: false,
  settings: { executionOrder: "v1" },
  nodes: [
    { parameters: { rule: { interval: [{ field: "hours", triggerAtHour: 14 }] } }, id: "c-schedule", name: "Daily Schedule", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [-80, 300] },
    ...coreNodes()
  ],
  connections: { "Daily Schedule": { main: [[{ node: "Build Prompt", type: "main", index: 0 }]] }, ...baseConns },
  pinData: {}
};

// --- manual deploy variant (CLI-runnable test/upload) ---
const manual = {
  id: "cleandeploynow",
  name: "DEPLOY — Cleaning public upload",
  active: false,
  settings: { executionOrder: "v1" },
  nodes: [
    { parameters: {}, id: "c-manual", name: "Manual Trigger", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [-80, 300] },
    ...coreNodes()
  ],
  connections: { "Manual Trigger": { main: [[{ node: "Build Prompt", type: "main", index: 0 }]] }, ...baseConns },
  pinData: {}
};

fs.mkdirSync(path.join(__dirname, "workflows"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "workflows", "cleaning-automation.json"), JSON.stringify(scheduled, null, 2));
fs.writeFileSync(path.join(__dirname, "workflows", "_cleaning-deploy.json"), JSON.stringify(manual, null, 2));
console.log("Wrote cleaning-automation.json and _cleaning-deploy.json");
