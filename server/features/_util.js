'use strict';

// Shared helpers for feature routers.

const rag = require('../rag');

/**
 * Resolve document text from either an explicit text body or a knowledge-base
 * document id. Returns { name, text } or throws if neither resolves.
 */
function resolveDocText({ id, text, name }, label = 'document') {
  if (text && text.trim()) return { name: name || label, text };
  if (id) {
    const t = rag.getDocText(id);
    if (t) {
      const meta = rag.getAllDocs().find(d => d.id === id);
      return { name: name || meta?.name || id, text: t };
    }
  }
  // Missing required input is a client error, not a server fault.
  const err = new Error(`No ${label} provided. Please select an uploaded document.`);
  err.status = 400;
  throw err;
}

/** Run an async mapper over items with bounded concurrency, preserving order. */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }
  const pool = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(pool);
  return results;
}

/** Pull deduped RAG context for a query, formatted as a prompt block. */
async function ragContextBlock(query, k = 8, opts = {}) {
  const hits = await rag.retrieve(query, k, opts).catch(() => []);
  if (!hits.length) return { block: '', citations: [] };
  const block = hits.map((c, i) => {
    const sec = c.section ? ` | §${c.section}` : '';
    return `--- [${i + 1}] ${c.source}${sec} ---\n${c.text}`;
  }).join('\n\n');
  const citations = [...new Set(hits.map(c => c.source))];
  return { block, citations, hits };
}

// ── Fuzzy system-name resolution ──────────────────────────────────────────────
// Engineers type system names freely — "MB/SRE", "steerring gear", "Main Swbd",
// "steering-gear system". Exact matching against historical lessons misses on the
// smallest typo/spacing/case difference, so a slightly-off name silently loses its
// history grounding. These helpers normalize and fuzzily compare system names.
const SYS_STOPWORDS = new Set(['system', 'systems', 'the', 'of', 'a', 'an', 'and', 'for', 'unit', 'assembly', 'arrangement']);

function normalizeSystem(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')          // any separator / punctuation → space
    .split(' ')
    .filter((w) => w && !SYS_STOPWORDS.has(w))
    .join(' ')
    .trim();
}

// Iterative Levenshtein edit distance (O(n·m); fine for short system labels).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Per-token fuzzy equality: exact, or within a small edit budget that scales with
// length (catches "steerring"→"steering") while keeping short tokens strict.
function tokenMatch(a, b) {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m >= 7) return levenshtein(a, b) <= 2;
  if (m >= 4) return levenshtein(a, b) <= 1;
  return false;
}

// 0..1 similarity between two system labels: fuzzy token-set overlap (order- and
// extra-word-tolerant) combined with whole-string edit distance (typo-tolerant).
function systemSimilarity(a, b) {
  const na = normalizeSystem(a);
  const nb = normalizeSystem(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = na.split(' ');
  const tb = nb.split(' ');
  const used = new Array(tb.length).fill(false);
  let shared = 0;
  for (const wa of ta) {
    for (let j = 0; j < tb.length; j++) {
      if (!used[j] && tokenMatch(wa, tb[j])) { used[j] = true; shared++; break; }
    }
  }
  const jaccard = shared / (ta.length + tb.length - shared);
  const editRatio = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(jaccard, editRatio);
}

// Resolve a free-text system name to the closest known system. Returns the matched
// candidate when it clears `threshold` and differs from the input, else the input.
function resolveSystemName(input, candidates = [], threshold = 0.6) {
  const raw = String(input || '').trim();
  let best = { name: raw, score: 0 };
  for (const c of candidates) {
    if (!c) continue;
    const score = systemSimilarity(raw, c);
    if (score > best.score) best = { name: c, score };
  }
  const matched = best.score >= threshold && normalizeSystem(best.name) !== normalizeSystem(raw);
  return { resolved: matched ? best.name : raw, score: best.score, matched };
}

module.exports = {
  resolveDocText, mapLimit, ragContextBlock,
  normalizeSystem, systemSimilarity, resolveSystemName,
};
