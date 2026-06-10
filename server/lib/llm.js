'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// On-premise inference engine
//   - getModel(systemInstruction)          → model handle (chat / vision)
//   - generateText(prompt, opts)           → plain text completion
//   - generateJSON(prompt, opts)           → parsed JSON
//   - generateJSONFromParts(parts, opts)   → parsed JSON from multimodal parts
//                                            (text + page images for scanned docs)
//
// All inference runs server-side on the local appliance; no credentials or
// document content ever reach the browser. Vision-capable requests receive page
// images (PDF pages are rasterised internally) for layout/figure understanding.
// ─────────────────────────────────────────────────────────────────────────────

const { rasterizePdfToPngs } = require('./rasterize');

// Model choice — balanced for this app and served REMOTELY (Groq), so model size
// costs nothing on our server:
//   • Text  → llama-3.3-70b-versatile: strong enough for clause-by-clause
//     compliance reasoning and reliable JSON extraction, while staying fast/cheap
//     on Groq. A small (8B) model is too weak for the technical nuance here; a
//     larger frontier model is needless cost. This is the sweet spot.
//   • Vision → llama-4-scout-17b: light multimodal model for reading scanned PDFs.
// Override either via LLM_MODEL / LLM_VISION_MODEL if your endpoint differs.
const ENGINE_URL    = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '') + '/chat/completions';
const ENGINE_KEY    = process.env.LLM_API_KEY || '';
const TEXT_MODEL    = process.env.LLM_MODEL        || 'llama-3.3-70b-versatile';
const VISION_MODEL  = process.env.LLM_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_COMPLETION = parseInt(process.env.LLM_MAX_TOKENS || '8000', 10);
// Per-request timeout so a slow/hung upstream fails cleanly instead of hanging
// until the host's proxy kills the whole request. Keep it under the platform's
// gateway timeout (Hostinger/LiteSpeed is typically ~100s).
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '100000', 10);
// Transient-failure resilience: a brief network blip ("fetch failed") or a
// 429/5xx from the upstream is retried with exponential backoff + jitter rather
// than surfacing as a hard error. Total attempts = LLM_MAX_RETRIES + 1. A whole
// endpoint (e.g. design review) makes many such calls, so one hiccup must not
// sink the request. Timeouts and client errors (4xx≠429) are NOT retried.
const LLM_MAX_RETRIES   = parseInt(process.env.LLM_MAX_RETRIES   || '2', 10);
const LLM_RETRY_BASE_MS = parseInt(process.env.LLM_RETRY_BASE_MS || '500', 10);
// Vision models accept only a handful of images per request — keep within that.
const MAX_VISION_PAGES = parseInt(process.env.LLM_MAX_VISION_PAGES || '5', 10);
const MAX_IMAGES_PER_REQUEST = 5;

// ── Robust JSON parsing ──────────────────────────────────────────────────────
function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const objMatch = t.match(/\{[\s\S]*\}/);
  const arrMatch = t.match(/\[[\s\S]*\]/);
  for (const c of [arrMatch?.[0], objMatch?.[0]].filter(Boolean)) {
    try { return JSON.parse(c); } catch (_) { /* try next */ }
  }
  return null;
}

// ── Multimodal part normalisation ────────────────────────────────────────────
// Accepts a string, or an array of { text } / { inlineData:{ mimeType, data } }.
// PDF inlineData is rasterised to page images so the vision model can read it.
async function normaliseParts(parts) {
  if (typeof parts === 'string') return { segments: [{ type: 'text', text: parts }], hasImage: false };

  const list = Array.isArray(parts) ? parts : [parts];
  const segments = [];
  let hasImage = false;

  for (const p of list) {
    if (p == null) continue;
    if (typeof p === 'string') { segments.push({ type: 'text', text: p }); continue; }
    if (p.text != null)        { segments.push({ type: 'text', text: String(p.text) }); continue; }
    if (p.inlineData) {
      const { mimeType, data } = p.inlineData;
      if (mimeType === 'application/pdf') {
        const pngs = await rasterizePdfToPngs(Buffer.from(data, 'base64'), { maxPages: MAX_VISION_PAGES }).catch(() => []);
        for (const pg of pngs) {
          segments.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${pg.data}` } });
          hasImage = true;
        }
      } else {
        const mt = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/png';
        segments.push({ type: 'image_url', image_url: { url: `data:${mt};base64,${data}` } });
        hasImage = true;
      }
    }
  }

  // Cap the number of images per request to what the vision model accepts.
  let imgCount = 0;
  const capped = segments.filter(s => {
    if (s.type !== 'image_url') return true;
    return ++imgCount <= MAX_IMAGES_PER_REQUEST;
  });
  return { segments: capped, hasImage };
}

// ── Core request ─────────────────────────────────────────────────────────────
function inferenceError(message, status) {
  const err = new Error(message);
  err.status = status;          // surfaced by route handlers as the HTTP status
  err.isInferenceError = true;
  return err;
}

// Upstream statuses worth retrying: rate-limit (429) and transient 5xx. Other
// 4xx are caller errors (bad request / auth) and must fail fast.
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callEngine(messages, { json = false, vision = false, maxOutputTokens = 4096, temperature = 0.2 } = {}) {
  if (!ENGINE_KEY) throw inferenceError('The local inference engine is not configured.', 503);
  // Built-in fetch requires Node 18+. A clear message beats a cryptic ReferenceError.
  if (typeof fetch !== 'function') {
    throw inferenceError('Server misconfiguration: Node.js 18+ is required (built-in fetch is unavailable). Set the Node version to 18 or higher in the hosting panel.', 500);
  }

  const body = {
    model:       vision ? VISION_MODEL : TEXT_MODEL,
    messages,
    temperature,
    max_tokens:  Math.min(maxOutputTokens || 4096, MAX_COMPLETION),
  };
  // Structured-output mode is reliable for text requests; vision requests rely on
  // prompt discipline + tolerant parsing instead.
  if (json && !vision) body.response_format = { type: 'json_object' };
  const payload = JSON.stringify(body);

  // Retry transient failures (transport "fetch failed", 429/5xx) with backoff.
  let lastReason = 'unknown error';
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = LLM_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(`[inference] ${lastReason} — retry ${attempt}/${LLM_MAX_RETRIES} in ${wait}ms`);
      await sleep(wait);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(ENGINE_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ENGINE_KEY}` },
        body:    payload,
        signal:  controller.signal,
      });
    } catch (err) {
      // A timeout already consumed the full budget — retrying only doubles the
      // wait, so fail fast.
      if (err.name === 'AbortError') {
        console.error(`[inference] request timed out after ${LLM_TIMEOUT_MS}ms`);
        throw inferenceError('The inference request timed out. Try again, or use a smaller document / fewer pages.', 504);
      }
      // Transport error (DNS/connection/TLS) — transient; retry if budget remains.
      lastReason = `transport error: ${err.message}`;
      console.error(`[inference] ${lastReason}`);
      if (attempt < LLM_MAX_RETRIES) continue;
      throw inferenceError('The local inference engine is unreachable.', 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }

    let detail = '';
    try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j); }
    catch (_) { detail = await res.text().catch(() => ''); }
    console.error(`[inference] HTTP ${res.status}: ${detail}`);

    if (RETRYABLE_HTTP.has(res.status) && attempt < LLM_MAX_RETRIES) {
      lastReason = `HTTP ${res.status}`;
      continue;
    }
    // 429 (rate/quota) is transient — signal "service unavailable, retry".
    const status = res.status === 429 ? 503 : 502;
    throw inferenceError(`The local inference engine returned an error (HTTP ${res.status}).`, status);
  }

  // Unreachable in practice (loop either returns or throws), but keep it total.
  throw inferenceError('The local inference engine is unreachable.', 502);
}

// ── Model handle (uniform surface used across the codebase) ───────────────────
function getModel(systemInstruction) {
  const system = systemInstruction || null;

  return {
    async generateContent(parts, genCfg = {}) {
      const { segments, hasImage } = await normaliseParts(parts);
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({
        role: 'user',
        content: (segments.length === 1 && segments[0].type === 'text') ? segments[0].text : segments,
      });
      const text = await callEngine(messages, {
        vision:          hasImage,
        json:            !!genCfg.json,
        temperature:     genCfg.temperature ?? 0.2,
        maxOutputTokens: genCfg.maxOutputTokens || 4096,
      });
      return { response: { text: () => text } };
    },

    startChat({ history = [] } = {}) {
      const base = [];
      if (system) base.push({ role: 'system', content: system });
      for (const h of history) {
        const role = h.role === 'model' ? 'assistant' : (h.role || 'user');
        const content = Array.isArray(h.parts) ? h.parts.map(p => p.text || '').join('\n') : (h.content || '');
        base.push({ role, content });
      }
      return {
        async sendMessage(message) {
          const msgs = [...base, { role: 'user', content: typeof message === 'string' ? message : String(message) }];
          const text = await callEngine(msgs, { temperature: 0.3, maxOutputTokens: 4096 });
          return { response: { text: () => text } };
        },
      };
    },
  };
}

// ── Convenience wrappers ─────────────────────────────────────────────────────
async function generateText(prompt, opts = {}) {
  const r = await getModel(opts.system).generateContent(prompt, {
    temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxOutputTokens || 4096, json: false,
  });
  return r.response.text();
}

async function generateJSON(prompt, opts = {}) {
  const model = getModel(opts.system);
  const r = await model.generateContent(prompt, {
    temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxOutputTokens || 8000, json: true,
  });
  let parsed = parseJsonLoose(r.response.text());
  if (parsed !== null) return parsed;

  const retry = await model.generateContent(
    `${typeof prompt === 'string' ? prompt : ''}\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONLY valid JSON — no markdown, no prose.`,
    { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxOutputTokens || 8000, json: true },
  );
  parsed = parseJsonLoose(retry.response.text());
  if (parsed !== null) return parsed;
  throw inferenceError('The model did not return a valid structured result. Please try again.', 502);
}

async function generateJSONFromParts(parts, opts = {}) {
  const r = await getModel(opts.system).generateContent(parts, {
    temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxOutputTokens || 8000, json: true,
  });
  const parsed = parseJsonLoose(r.response.text());
  if (parsed === null) throw inferenceError('The model could not read this document into a structured result. Please try again.', 502);
  return parsed;
}

module.exports = {
  getModel,
  generateText,
  generateJSON,
  generateJSONFromParts,
  parseJsonLoose,
};
