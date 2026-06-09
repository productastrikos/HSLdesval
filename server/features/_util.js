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

module.exports = { resolveDocText, mapLimit, ragContextBlock };
