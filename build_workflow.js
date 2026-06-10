// Generates a valid, importable n8n workflow JSON.
// Run once:  node build_workflow.js   ->  workflows/youtube-shorts-automation.json
const fs = require('fs');
const path = require('path');

const systemPrompt = [
  "You are a viral YouTube Shorts scriptwriter specialising in surprising, verifiable",
  "\"Did you know?\" facts. Return ONLY a single JSON object, no markdown, with EXACTLY these keys:",
  "",
  "  hook        - a 1-sentence pattern-interrupt opener (also the first line of the script).",
  "  script      - the FULL narration to be spoken. Start with the hook. 90-130 words.",
  "                Conversational, punchy, ONE genuinely surprising verified fact.",
  "                End with a short question or a 'follow for more' style line.",
  "                No emojis, no hashtags, no stage directions - it will be read aloud verbatim.",
  "  title       - <= 90 chars, curiosity-driven, MUST end with ' #Shorts'.",
  "  description - 2-3 sentences, then a new line with 5 relevant hashtags.",
  "  tags        - array of 8-12 lowercase keyword strings.",
  "  query       - 1-2 word stock-video search term matching the visual mood",
  "                (e.g. 'galaxy', 'deep ocean', 'city night', 'rainforest').",
  "  voice       - exactly one of: en-US-AriaNeural, en-US-GuyNeural, en-GB-SoniaNeural.",
  "",
  "Vary topics across science, space, history, biology, psychology, technology and nature.",
  "Pick facts that are accurate and genuinely make people go 'wait, what?!'."
].join("\n");

const buildPromptCode = [
  "// Build the Groq chat-completion request body.",
  "const system = $node[\"_SYSTEM_PLACEHOLDER_\"]; // replaced below",
  "const body = {",
  "  model: 'llama-3.3-70b-versatile',",
  "  temperature: 0.95,",
  "  response_format: { type: 'json_object' },",
  "  messages: [",
  "    { role: 'system', content: system },",
  "    { role: 'user', content: 'Generate ONE fresh Short now. Respond with the JSON object only.' }",
  "  ]",
  "};",
  "return [{ json: { body } }];"
].join("\n");

// Inline the system prompt as a JS string literal (JSON.stringify handles escaping).
const buildPromptFinal = buildPromptCode.replace(
  '$node["_SYSTEM_PLACEHOLDER_"]; // replaced below',
  JSON.stringify(systemPrompt) + ';'
);

const parseScriptCode = [
  "// Groq returns the JSON object as a string in choices[0].message.content.",
  "const res = $input.first().json;",
  "const content = res.choices && res.choices[0] && res.choices[0].message.content;",
  "if (!content) throw new Error('No content from LLM: ' + JSON.stringify(res).slice(0, 500));",
  "let data;",
  "try { data = JSON.parse(content); }",
  "catch (e) { throw new Error('LLM did not return valid JSON: ' + content.slice(0, 500)); }",
  "if (!data.script || !data.title) throw new Error('LLM JSON missing script/title');",
  "data.tags = Array.isArray(data.tags) ? data.tags : [];",
  "data.voice = data.voice || 'en-US-AriaNeural';",
  "data.query = data.query || 'abstract';",
  "return [{ json: data }];"
].join("\n");

const buildJobCode = [
  "// Create a unique run folder id and a base64 job payload for produce.sh.",
  "const item = $input.first().json;",
  "const runId = String($execution.id || Date.now());",
  "const runDir = `/data/${runId}`;",
  "const job = { script: item.script, query: item.query, voice: item.voice };",
  "const jobB64 = Buffer.from(JSON.stringify(job), 'utf8').toString('base64');",
  "return [{ json: {",
  "  runId, runDir, jobB64,",
  "  title: item.title,",
  "  description: item.description,",
  "  tags: item.tags",
  "} }];"
].join("\n");

const produceCommand =
  "mkdir -p {{ $json.runDir }} && " +
  "echo '{{ $json.jobB64 }}' | base64 -d > {{ $json.runDir }}/job.json && " +
  "/scripts/produce.sh {{ $json.runDir }}";

const wf = {
  id: "shortsdidyouknow",
  name: "YouTube Shorts — Did You Know (Automated)",
  active: false,
  settings: { executionOrder: "v1" },
  nodes: [
    {
      parameters: {
        rule: { interval: [{ field: "hours", triggerAtHour: 14 }] }
      },
      id: "node-schedule",
      name: "Daily Schedule",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [-80, 300]
    },
    {
      parameters: { jsCode: buildPromptFinal },
      id: "node-buildprompt",
      name: "Build Prompt",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [180, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "https://api.groq.com/openai/v1/chat/completions",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: "={{ 'Bearer ' + $env.GROQ_API_KEY }}" },
            { name: "Content-Type", value: "application/json" }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ $json.body }}",
        options: { timeout: 60000 }
      },
      id: "node-groq",
      name: "Generate Script (Groq)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [440, 300]
    },
    {
      parameters: { jsCode: parseScriptCode },
      id: "node-parse",
      name: "Parse Script",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [700, 300]
    },
    {
      parameters: { jsCode: buildJobCode },
      id: "node-buildjob",
      name: "Build Job",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [960, 300]
    },
    {
      parameters: { command: "=" + produceCommand },
      id: "node-produce",
      name: "Produce Video",
      type: "n8n-nodes-base.executeCommand",
      typeVersion: 1,
      position: [1220, 300]
    },
    {
      parameters: {
        operation: "read",
        fileSelector: "={{ $('Build Job').item.json.runDir }}/video.mp4",
        options: {}
      },
      id: "node-readvideo",
      name: "Read Video File",
      type: "n8n-nodes-base.readWriteFile",
      typeVersion: 1,
      position: [1480, 300]
    },
    {
      parameters: {
        resource: "video",
        operation: "upload",
        title: "={{ $('Parse Script').item.json.title }}",
        categoryId: "27",
        binaryProperty: "data",
        options: {
          description: "={{ $('Parse Script').item.json.description }}",
          privacyStatus: "private",
          tags: "={{ ($('Parse Script').item.json.tags || []).join(',') }}"
        }
      },
      id: "node-youtube",
      name: "Upload to YouTube",
      type: "n8n-nodes-base.youTube",
      typeVersion: 1,
      position: [1740, 300],
      credentials: {
        youTubeOAuth2Api: { id: "REPLACE_ME", name: "YouTube account" }
      }
    }
  ],
  connections: {
    "Daily Schedule":          { main: [[{ node: "Build Prompt",           type: "main", index: 0 }]] },
    "Build Prompt":            { main: [[{ node: "Generate Script (Groq)", type: "main", index: 0 }]] },
    "Generate Script (Groq)":  { main: [[{ node: "Parse Script",           type: "main", index: 0 }]] },
    "Parse Script":            { main: [[{ node: "Build Job",              type: "main", index: 0 }]] },
    "Build Job":               { main: [[{ node: "Produce Video",          type: "main", index: 0 }]] },
    "Produce Video":           { main: [[{ node: "Read Video File",        type: "main", index: 0 }]] },
    "Read Video File":         { main: [[{ node: "Upload to YouTube",      type: "main", index: 0 }]] }
  },
  pinData: {}
};

const outDir = path.join(__dirname, "workflows");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "youtube-shorts-automation.json");
fs.writeFileSync(outPath, JSON.stringify(wf, null, 2));
console.log("Wrote", outPath);
