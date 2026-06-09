'use strict';

const path = require('path');
const fs   = require('fs');

const CACHE_DIR  = path.join(__dirname, 'embcache');
const CACHE_FILE = path.join(CACHE_DIR, 'store.json');
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 32;

// ── Semantic embeddings are OPTIONAL (off by default, for a light footprint) ──
// They rely on @xenova/transformers (the onnxruntime-node native ML runtime):
// heavy native binaries, a model download, and a RAM/CPU spike while the index is
// built — which OOM-crashes memory-capped shared hosting. So the package is NOT
// installed by default and retrieval uses the pure-JS BM25 keyword leg, which
// deploys anywhere with zero native deps and is well-suited to clause/standard
// lookups. To enable semantic search on a host with headroom (e.g. a VPS):
//   1) cd server && npm install @xenova/transformers
//   2) set RAG_SEMANTIC=on
//   3) (optional) ship server/rag/embcache/store.json so it needn't rebuild at boot
// If the flag is on but the package is missing, getModel() throws → caught → the
// engine transparently falls back to BM25, so nothing breaks.
const SEMANTIC_ENABLED = /^(1|true|on|yes)$/i.test(process.env.RAG_SEMANTIC || '');

let _pipe  = null;
let _cache = new Map();  // hashKey → number[]

// ── Embedding cache (disk-backed) ─────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw)) _cache.set(k, v);
      console.log(`[Embedder] Loaded ${_cache.size} cached vectors from disk`);
    }
  } catch (err) {
    console.warn('[Embedder] Cache load failed:', err.message);
  }
}

let _saveTimer = null;

function flushCache() {
  // No-op when semantic mode is off — the in-memory cache is empty, and writing
  // it would clobber any prebuilt store.json on disk.
  if (!SEMANTIC_ENABLED) return;
  try {
    const out = {};
    for (const [k, v] of _cache.entries()) out[k] = v;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
  } catch (err) {
    console.warn('[Embedder] Cache save failed:', err.message);
  }
}

function schedSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { flushCache(); _saveTimer = null; }, 3000);
}

// Guarantee cache is written even on clean process exit (only when semantic mode
// is on — otherwise there is nothing to persist).
if (SEMANTIC_ENABLED) {
  process.once('exit',    flushCache);
  process.once('SIGINT',  () => { flushCache(); process.exit(0); });
  process.once('SIGTERM', () => { flushCache(); process.exit(0); });
}

// FNV-1a 32-bit hash for cache keys
function hashStr(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// ── Model loader (lazy, singleton) ───────────────────────────────────────────

let _modelLoading = null;

async function getModel() {
  if (_pipe) return _pipe;
  if (_modelLoading) return _modelLoading;

  _modelLoading = (async () => {
    console.log('[Embedder] Loading semantic model (Xenova/all-MiniLM-L6-v2, downloads ~22 MB on first run)…');
    const { pipeline } = await import('@xenova/transformers');
    _pipe = await pipeline('feature-extraction', MODEL_NAME, { quantized: true });
    console.log('[Embedder] Semantic embedding model ready');
    return _pipe;
  })();

  return _modelLoading;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embed a batch of texts. Returns number[][] (normalized 384-dim vectors).
 * Falls back to null entries on error.
 */
async function embedBatch(texts) {
  if (!texts.length) return [];
  // Disabled → no model, no native runtime, no boot-time spike. Null vectors make
  // callers transparently fall back to BM25-only retrieval.
  if (!SEMANTIC_ENABLED) return texts.map(() => null);

  let model;
  try {
    model = await getModel();
  } catch (err) {
    console.warn('[Embedder] Model load failed, semantic search disabled:', err.message);
    return texts.map(() => null);
  }

  const results = new Array(texts.length).fill(null);
  const todo    = [];

  for (let i = 0; i < texts.length; i++) {
    const key = hashStr(texts[i]);
    if (_cache.has(key)) {
      results[i] = _cache.get(key);
    } else {
      todo.push({ i, text: texts[i], key });
    }
  }

  for (let b = 0; b < todo.length; b += BATCH_SIZE) {
    const batch = todo.slice(b, b + BATCH_SIZE);
    try {
      const out = await model(batch.map(x => x.text), { pooling: 'mean', normalize: true });
      for (let j = 0; j < batch.length; j++) {
        const vec = Array.from(out[j].data);
        _cache.set(batch[j].key, vec);
        results[batch[j].i] = vec;
      }
    } catch (err) {
      console.warn(`[Embedder] Batch ${b}-${b + BATCH_SIZE} failed:`, err.message);
    }
  }

  if (todo.length) schedSave();
  return results;
}

async function embedOne(text) {
  const r = await embedBatch([text]);
  return r[0];
}

/**
 * Dot product of two normalized vectors (= cosine similarity for unit vectors).
 */
function dotProduct(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Prime the cache on module load (only when semantic mode is on — avoids reading
// the multi-MB store.json into memory when it will not be used).
if (SEMANTIC_ENABLED) loadCache();

module.exports = { embedBatch, embedOne, dotProduct, flushCache };
