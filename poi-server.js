/**
 * POI Extraction Server
 *
 * Queue-based AI-powered place info extraction using web search.
 * Supports any OpenAI-compatible provider (OpenAI, LM Studio, Groq, etc.)
 * and Anthropic. Uses Jina.ai + DuckDuckGo for free web search — no extra
 * API keys required beyond your LLM provider.
 *
 * Configuration (environment variables):
 *   POI_PORT      Port to listen on              (default: 3004)
 *   POI_PROVIDER  'openai', 'anthropic', or 'poorclaudeapi'  (default: 'openai')
 *   POI_API_KEY   API key for the provider                   (required for openai/anthropic)
 *   POI_MODEL     Model name                                 (default: gpt-4o-mini / claude-haiku-4-5-20251001 / sonnet)
 *   POI_BASE_URL  Base URL override
 *                 openai default:        https://api.openai.com
 *                 LM Studio:             http://localhost:1234
 *                 Groq:                  https://api.groq.com/openai
 *                 OpenRouter:            https://openrouter.ai/api
 *                 poorclaudeapi default: http://127.0.0.1:8000
 *
 * Usage:  node poi-server.js
 * Needs:  Node 18+ (uses native fetch)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== Load env file (poi-server.env or .env) =====
// Allows configuration without setting shell environment variables.
// Shell environment variables always take precedence over the file.
for (const envFile of ['poi-server.env', '.env']) {
    try {
        const lines = fs.readFileSync(path.join(__dirname, envFile), 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
            if (m && process.env[m[1]] === undefined) {
                process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
            }
        }
        console.log(`[POI] Loaded config from ${envFile}`);
        break;
    } catch {}
}

// ===== Configuration =====

const PORT = process.env.POI_PORT || 3004;
const PROVIDER = (process.env.POI_PROVIDER || 'openai').toLowerCase();
const API_KEY = process.env.POI_API_KEY || '';
const MODEL = process.env.POI_MODEL || (
    PROVIDER === 'anthropic'     ? 'claude-haiku-4-5-20251001' :
    PROVIDER === 'poorclaudeapi' ? 'sonnet' :
    'gpt-4o-mini'
);
const BASE_URL = (process.env.POI_BASE_URL || (
    PROVIDER === 'anthropic'     ? 'https://api.anthropic.com' :
    PROVIDER === 'poorclaudeapi' ? 'http://127.0.0.1:8000' :
    'https://api.openai.com'
)).replace(/\/$/, '');

const JOBS_FILE = path.join(__dirname, 'poi-jobs.json');
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

if (!API_KEY && PROVIDER !== 'poorclaudeapi') {
    console.warn('[POI] Warning: POI_API_KEY is not set. AI extraction will fail.');
}

// ===== Tool definitions =====

const TOOLS_OPENAI = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for current information about a place',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch the text content of a web page',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Full URL to fetch' },
                },
                required: ['url'],
            },
        },
    },
];

const TOOLS_ANTHROPIC = [
    {
        name: 'web_search',
        description: 'Search the web for current information about a place',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
        },
    },
    {
        name: 'fetch_url',
        description: 'Fetch the text content of a web page',
        input_schema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Full URL to fetch' },
            },
            required: ['url'],
        },
    },
];

// ===== Prompts =====

const SYSTEM_PROMPT = `You are a place information extraction assistant.
Use web_search to find the place, then fetch_url on its official website or a relevant page for accurate details.
Return ONLY a valid JSON object — no markdown fences, no explanation.
Use empty string "" for any field you cannot find.
For category use exactly one of: restaurant, hotel, sightseeing, shopping, general.
For opening_hours summarize concisely, e.g. "Mon-Sat 10:00-22:00, Sun closed".`;

const JSON_FIELDS = `  name          - Official place name
  category      - restaurant, hotel, sightseeing, shopping, or general
  address       - Full street address
  city          - City name
  phone         - Phone number with country code
  website       - Official website URL
  opening_hours - Opening hours summary
  price_level   - Price level: $, $$, or $$$
  rating        - Rating score (e.g. 4.5)
  review_count  - Number of reviews
  cuisine       - Cuisine type (restaurants only)
  description   - One-line description of the place
  lat           - Latitude as a decimal number (e.g. 48.8566)
  lng           - Longitude as a decimal number (e.g. 2.3522)`;

function buildPrompt(placeName, locationHint) {
    const loc = locationHint ? ` in ${locationHint}` : '';
    return `Find accurate, current information about "${placeName}"${loc}.

Search for it, then fetch a relevant page (official website, Google Maps, TripAdvisor, etc.) for details like phone number, opening hours, and prices.

Return a JSON object with these fields:\n${JSON_FIELDS}`;
}

function buildPromptForUrl(url) {
    return `Fetch the following URL and extract place information from it:
${url}

Use fetch_url to read the page content, then return the place details as JSON.
If the page doesn't contain enough detail, use web_search to find more about the place.

Return a JSON object with these fields:\n${JSON_FIELDS}`;
}

// ===== Jina.ai fetcher =====

async function jinaFetch(targetUrl, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`https://r.jina.ai/${targetUrl}`, {
            headers: {
                'Accept': 'text/plain',
                'X-No-Cache': 'true',
            },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

function cleanContent(text, isSearch = false) {
    if (!text) return '';

    // Strip base64 image embeds
    text = text.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '');
    // Strip external image links (favicons, thumbnails)
    text = text.replace(/!\[[^\]]*\]\(https?:\/\/[^)]+\)/g, '');

    if (isSearch) {
        // Strip DuckDuckGo ad/tracking links
        text = text.replace(/\[[^\]]*\]\(https:\/\/duckduckgo\.com\/y\.js[^)]+\)/g, '');
        // Strip any remaining very long URLs (tracking parameters)
        text = text.replace(/\[[^\]]*\]\(https?:\/\/[^)]{250,}\)/g, '');
        // Remove "Report Ad" markers
        text = text.replace(/\bReport Ad\b\s*/gi, '');

        // Keep only the numbered results block
        const startMatch = text.match(/\n\d+\.\s+\S/);
        if (startMatch) text = text.slice(text.indexOf(startMatch[0]));

        // Strip footer navigation (starts after last real result)
        text = text.replace(/\n\s*[-*]\s*(?:Search|Homepage|Downloads|More From DuckDuckGo)\b[\s\S]*$/m, '');
    }

    // Collapse excessive blank lines
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // Truncate to avoid sending huge context
    const MAX = 4000;
    if (text.length > MAX) text = text.slice(0, MAX) + '\n[content truncated]';

    return text;
}

// ===== Tool execution =====

async function executeTool(name, args) {
    console.log(`[POI]   tool ${name}(${JSON.stringify(args)})`);
    try {
        if (name === 'web_search') {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
            const raw = await jinaFetch(url);
            return cleanContent(raw, true) || 'No search results found.';
        }
        if (name === 'fetch_url') {
            const raw = await jinaFetch(args.url);
            return cleanContent(raw, false) || 'No content retrieved.';
        }
        return `Unknown tool: ${name}`;
    } catch (err) {
        return `Tool error: ${err.message}`;
    }
}

// ===== Anthropic agentic loop =====

async function runAnthropicLoop(placeName, locationHint) {
    const messages = [{ role: 'user', content: buildPrompt(placeName, locationHint) }];

    for (let turn = 0; turn < 8; turn++) {
        const res = await fetch(`${BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                tools: TOOLS_ANTHROPIC,
                messages,
            }),
        });
        if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
        const data = await res.json();

        messages.push({ role: 'assistant', content: data.content });

        if (data.stop_reason === 'end_turn') {
            return data.content.find(b => b.type === 'text')?.text || '';
        }

        if (data.stop_reason === 'tool_use') {
            const toolBlocks = data.content.filter(b => b.type === 'tool_use');
            const results = [];
            for (const block of toolBlocks) {
                const result = await executeTool(block.name, block.input);
                results.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
            messages.push({ role: 'user', content: results });
        }
    }
    throw new Error('Max turns reached');
}

// ===== OpenAI-compatible agentic loop =====

async function runOpenAILoop(placeName, locationHint) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(placeName, locationHint) },
    ];

    for (let turn = 0; turn < 8; turn++) {
        const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages,
                tools: TOOLS_OPENAI,
            }),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
        const data = await res.json();

        const choice = data.choices?.[0];
        if (!choice) throw new Error('Empty response from API');

        messages.push(choice.message);

        if (choice.finish_reason === 'stop') {
            return choice.message.content || '';
        }

        if (choice.finish_reason === 'tool_calls') {
            for (const tc of choice.message.tool_calls || []) {
                const args = JSON.parse(tc.function.arguments);
                const result = await executeTool(tc.function.name, args);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            }
        }
    }
    throw new Error('Max turns reached');
}

// ===== poorClaudeAPI single-turn call =====
// Uses the local poorClaudeAPI wrapper (https://github.com/your-repo/poorClaudeAPI)
// which runs the Claude CLI with WebSearch enabled and handles the agentic loop internally.

const POOR_CLAUDE_JSON_SCHEMA = {
    type: 'object',
    properties: {
        name:          { type: 'string', description: 'Official place name' },
        category:      { type: 'string', description: 'One of: restaurant, hotel, sightseeing, shopping, general' },
        address:       { type: 'string', description: 'Full street address' },
        city:          { type: 'string', description: 'City or town name' },
        phone:         { type: 'string', description: 'Phone number with country code' },
        website:       { type: 'string', description: 'Official website URL' },
        opening_hours: { type: 'string', description: 'Opening hours summary e.g. Mon-Sat 10:00-22:00' },
        price_level:   { type: 'string', description: 'Price level: $, $$, or $$$' },
        rating:        { type: 'string', description: 'Rating score e.g. 4.5' },
        review_count:  { type: 'string', description: 'Number of reviews' },
        cuisine:       { type: 'string', description: 'Cuisine type (restaurants only)' },
        description:   { type: 'string', description: 'One-line description of the place' },
    },
    required: ['name'],
};

async function runPoorClaudeAPILoop(placeName, locationHint) {
    const loc = locationHint ? ` located in ${locationHint}` : '';
    const prompt = `Search the web for information about the place called "${placeName}"${loc}.
Find accurate details including: full address, phone number, official website, opening hours, ratings, reviews, price level, cuisine type (if a restaurant), and a brief description.
Use the location "${locationHint || 'unknown'}" to disambiguate if there are multiple places with this name.
Return ONLY the structured JSON. Leave fields as empty string "" if not found.
For category pick the best match from: restaurant, hotel, sightseeing, shopping, general.`;

    const res = await fetch(`${BASE_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            model: MODEL,
            max_budget_usd: 0.25,
            system_prompt: 'You are a data extraction assistant. Search the web to find accurate place information. Return valid JSON only.',
            json_schema: POOR_CLAUDE_JSON_SCHEMA,
            allowed_tools: ['WebSearch'],
        }),
    });
    if (!res.ok) throw new Error(`poorClaudeAPI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.response || data.response.startsWith('Error:')) {
        throw new Error(data.response || 'Empty response from poorClaudeAPI');
    }
    return data.response;
}

// ===== POI extraction =====

function extractPlaceName(url) {
    const match = url.match(/\/place\/([^/@?]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
}

async function reverseGeocode(lat, lng) {
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'EasyItinerary/1.0' }, signal: controller.signal }
        );
        const data = await res.json();
        const a = data.address || {};
        const city = a.city || a.town || a.village || a.county || '';
        const country = a.country || '';
        return [city, country].filter(Boolean).join(', ');
    } catch { return ''; }
}

function parseJsonResponse(text) {
    if (!text) throw new Error('Empty response');
    if (typeof text === 'object') return text;
    // Try direct parse first
    try { return JSON.parse(text); } catch {}
    // Extract JSON object from surrounding text
    const match = text.match(/\{[\s\S]+\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('No valid JSON found in response');
}

async function extractPOI(url, lat, lng) {
    const placeName = extractPlaceName(url);

    if (placeName) {
        // Google Maps URL — use place name + location hint from coordinates
        let locationHint = '';
        if (lat && lng) {
            locationHint = await reverseGeocode(lat, lng);
            console.log(`[POI] "${placeName}" — location: ${locationHint || '(unknown)'}`);
        }
        const rawText = PROVIDER === 'anthropic'     ? await runAnthropicLoop(placeName, locationHint)
                      : PROVIDER === 'poorclaudeapi' ? await runPoorClaudeAPILoop(placeName, locationHint)
                      : await runOpenAILoop(placeName, locationHint);
        return parseJsonResponse(rawText);
    } else {
        // Non-Google URL — fetch and extract directly via AI
        console.log(`[POI] Extracting from URL: ${url.substring(0, 80)}`);
        const rawText = PROVIDER === 'poorclaudeapi'
            ? await runPoorClaudeAPIWithUrl(url)
            : await runLoopWithUrl(url);
        return parseJsonResponse(rawText);
    }
}

async function runLoopWithUrl(url) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPromptForUrl(url) },
    ];
    for (let turn = 0; turn < 8; turn++) {
        const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
            body: JSON.stringify({ model: MODEL, messages, tools: TOOLS_OPENAI }),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const choice = data.choices?.[0];
        if (!choice) throw new Error('Empty response');
        messages.push(choice.message);
        if (choice.finish_reason === 'stop') return choice.message.content || '';
        if (choice.finish_reason === 'tool_calls') {
            for (const tc of choice.message.tool_calls || []) {
                const result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments));
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
            }
        }
    }
    throw new Error('Max turns reached');
}

async function runPoorClaudeAPIWithUrl(url) {
    const prompt = `Fetch and extract place information from this URL: ${url}
Search the web if needed to find: name, address, city, phone, website, opening hours, price level, rating, reviews, cuisine (if restaurant), and a brief description.
Return ONLY the structured JSON. Leave fields as empty string "" if not found.`;
    const res = await fetch(`${BASE_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt, model: MODEL, max_budget_usd: 0.25,
            system_prompt: 'You are a data extraction assistant. Return valid JSON only.',
            json_schema: POOR_CLAUDE_JSON_SCHEMA,
            allowed_tools: ['WebSearch'],
        }),
    });
    if (!res.ok) throw new Error(`poorClaudeAPI ${res.status}`);
    const data = await res.json();
    if (!data.response || data.response.startsWith('Error:')) throw new Error(data.response || 'Empty response');
    return data.response;
}

// ===== Job queue =====

const jobs = new Map();
let queueRunning = false;

function persistJobs() {
    const toSave = {};
    for (const [id, job] of jobs) {
        if (job.status === 'done' || job.status === 'error') toSave[id] = job;
    }
    try { fs.writeFileSync(JOBS_FILE, JSON.stringify(toSave)); } catch {}
}

function loadJobs() {
    try {
        const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
        const cutoff = Date.now() - JOB_TTL_MS;
        for (const [id, job] of Object.entries(raw)) {
            if (job.createdAt > cutoff) jobs.set(id, job);
        }
        console.log(`[POI] Loaded ${jobs.size} cached job(s) from disk`);
    } catch {}
}

function pruneOldJobs() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) {
        if (job.createdAt < cutoff) jobs.delete(id);
    }
    persistJobs();
}

function enqueue(url, lat, lng) {
    const jobId = crypto.randomBytes(6).toString('hex');
    jobs.set(jobId, { status: 'queued', url, lat, lng, createdAt: Date.now() });
    console.log(`[POI] Queued job ${jobId}: ${url.substring(0, 80)}`);
    pruneOldJobs();
    processQueue();
    return jobId;
}

async function processQueue() {
    if (queueRunning) return;
    const entry = [...jobs.entries()].find(([, j]) => j.status === 'queued');
    if (!entry) return;

    const [jobId, job] = entry;
    queueRunning = true;
    job.status = 'running';
    console.log(`[POI] Processing job ${jobId}`);

    try {
        const result = await extractPOI(job.url, job.lat, job.lng);
        if (result.error) {
            job.status = 'error';
            job.error = result.error;
            console.log(`[POI] Job ${jobId} failed: ${result.error}`);
        } else {
            job.status = 'done';
            job.result = result;
            console.log(`[POI] Job ${jobId} done: ${result.name}`);
        }
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        console.error(`[POI] Job ${jobId} error:`, err.message);
    }

    queueRunning = false;
    persistJobs();
    processQueue();
}

// ===== HTTP server =====

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // POST /extract — submit a job, returns { jobId } immediately
    if (req.method === 'POST' && req.url === '/extract') {
        try {
            const { url, lat, lng } = JSON.parse(await readBody(req));
            if (!url || !url.startsWith('http')) {
                return send(res, 400, { error: 'Invalid URL' });
            }
            const jobId = enqueue(url, lat || null, lng || null);
            const queuePos = [...jobs.values()].filter(j => j.status === 'queued').length;
            send(res, 202, { jobId, queuePosition: queuePos });
        } catch (err) {
            send(res, 400, { error: err.message });
        }
        return;
    }

    // GET /status/:jobId — poll job status
    if (req.method === 'GET' && req.url.startsWith('/status/')) {
        const jobId = req.url.slice('/status/'.length);
        const job = jobs.get(jobId);
        if (!job) return send(res, 404, { error: 'Job not found' });
        const queuePos = job.status === 'queued'
            ? [...jobs.values()].filter(j => j.status === 'queued').indexOf(job) + 1
            : 0;
        send(res, 200, { jobId, status: job.status, queuePosition: queuePos, result: job.result || null, error: job.error || null });
        return;
    }

    // GET /health
    if (req.method === 'GET' && req.url === '/health') {
        send(res, 200, {
            status: 'ok',
            provider: PROVIDER,
            model: MODEL,
            queueLength: [...jobs.values()].filter(j => j.status === 'queued').length,
            running: queueRunning,
        });
        return;
    }

    res.writeHead(404); res.end('Not found');
});

loadJobs();
server.listen(PORT, '127.0.0.1', () => {
    console.log(`POI extraction server running at http://127.0.0.1:${PORT}`);
    console.log(`Provider: ${PROVIDER} / Model: ${MODEL}`);
    if (!API_KEY && PROVIDER !== 'poorclaudeapi') console.warn('[POI] Warning: POI_API_KEY not set');
});
