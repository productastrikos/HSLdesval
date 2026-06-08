'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Gemini LLM helpers
//   - getModel(systemInstruction)          → raw GenerativeModel (chat / vision)
//   - generateText(prompt, opts)           → plain text completion
//   - generateJSON(prompt, opts)           → parsed JSON (responseMimeType=json)
//   - generateJSONFromParts(parts, opts)   → parsed JSON from multimodal parts
//                                            (PDF / image inlineData + text)
// All calls run server-side; the API key never reaches the client.
// ─────────────────────────────────────────────────────────────────────────────

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI        = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getModel(systemInstruction) {
  const opts = { model: GEMINI_MODEL };
  if (systemInstruction) opts.systemInstruction = systemInstruction;
  return genAI.getGenerativeModel(opts);
}

// ── Robust JSON parsing ─────────────────────────────────────────────────────
// Gemini in JSON mode usually returns clean JSON, but we defend against stray
// markdown fences, leading prose, or trailing commentary.
function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();

  // Strip ```json … ``` fences if present
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try { return JSON.parse(t); } catch (_) { /* fall through */ }

  // Grab the first {...} or [...] block
  const objMatch = t.match(/\{[\s\S]*\}/);
  const arrMatch = t.match(/\[[\s\S]*\]/);
  const candidates = [arrMatch?.[0], objMatch?.[0]].filter(Boolean);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (_) { /* try next */ }
  }
  return null;
}

async function _callText(parts, { system, maxOutputTokens = 8192, temperature = 0.2, json = false } = {}) {
  const model = getModel(system);
  const generationConfig = { temperature, maxOutputTokens };
  if (json) generationConfig.responseMimeType = 'application/json';

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: Array.isArray(parts) ? parts : [{ text: parts }] }],
    generationConfig,
  });
  return result.response.text();
}

async function generateText(prompt, opts = {}) {
  return _callText(prompt, { ...opts, json: false });
}

/**
 * Generate parsed JSON. Retries once with a stricter reminder if parsing fails.
 */
async function generateJSON(prompt, opts = {}) {
  const raw = await _callText(prompt, { ...opts, json: true, maxOutputTokens: opts.maxOutputTokens || 16384 });
  let parsed = parseJsonLoose(raw);
  if (parsed !== null) return parsed;

  // One retry with an explicit correction instruction
  const retryRaw = await _callText(
    `${typeof prompt === 'string' ? prompt : ''}\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONLY valid JSON — no markdown, no prose.`,
    { ...opts, json: true, maxOutputTokens: opts.maxOutputTokens || 16384 },
  );
  parsed = parseJsonLoose(retryRaw);
  if (parsed !== null) return parsed;

  throw new Error('Model did not return parseable JSON.');
}

/**
 * Multimodal JSON: parts = [{ inlineData:{mimeType,data} }, { text }, …].
 * Used for reading drawings / scanned PDFs.
 */
async function generateJSONFromParts(parts, opts = {}) {
  const raw = await _callText(parts, { ...opts, json: true, maxOutputTokens: opts.maxOutputTokens || 16384 });
  const parsed = parseJsonLoose(raw);
  if (parsed === null) throw new Error('Model did not return parseable JSON from document.');
  return parsed;
}

module.exports = {
  genAI,
  GEMINI_MODEL,
  getModel,
  generateText,
  generateJSON,
  generateJSONFromParts,
  parseJsonLoose,
};
