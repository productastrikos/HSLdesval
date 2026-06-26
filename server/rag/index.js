'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Full-fledged RAG Engine
// Hybrid BM25 + semantic embeddings → RRF fusion → MMR diversity
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');

const { chunkText }                    = require('./chunker');
const { BM25 }                         = require('./bm25');
const { embedBatch, embedOne, flushCache } = require('./embedder');
const { VectorStore }                  = require('./vectorStore');
const { mmrSelect }                    = require('./mmr');

// ── In-memory stores ──────────────────────────────────────────────────────────
const docStore   = new Map();   // docId → { id, name, type, text, addedAt, chunkCount }
const chunkStore = new Map();   // chunkId → chunk meta
const bm25       = new BM25();
const vecStore   = new VectorStore();

let _kbReady = false;

// ── Maritime abbreviation expander ────────────────────────────────────────────
const MARITIME_ABBREV = {
  ows: 'oily water separator', orb: 'oil record book',
  ism: 'international safety management', isps: 'ship port facility security',
  gmdss: 'global maritime distress safety system',
  vdr: 'voyage data recorder', ecdis: 'electronic chart display information',
  nsqr: 'naval staff qualitative requirements shock',
  ndt: 'non destructive testing examination', ut: 'ultrasonic testing',
  rt: 'radiographic testing', pt: 'penetrant testing',
  mcr: 'maximum continuous rated power', cpp: 'controllable pitch propeller',
  fpp: 'fixed pitch propeller', hvac: 'heating ventilation air conditioning',
  msb: 'main switchboard', esb: 'emergency switchboard',
  avr: 'automatic voltage regulator', thd: 'total harmonic distortion',
  lszh: 'low smoke zero halogen cable', bwm: 'ballast water management',
  marpol: 'marine pollution prevention annex discharge',
  solas: 'safety life at sea fire stability',
  iacs: 'international association classification societies unified requirements',
  irs: 'indian register of shipping classification rules',
  dnv: 'det norske veritas classification rules',
  abs: 'american bureau of shipping rules',
  iec: 'international electrotechnical commission standard',
  pspc: 'protective coating performance standard',
  iccp: 'impressed current cathodic protection',
  dp: 'dynamic positioning thruster',
  pms: 'power management system', ums: 'unattended machinery space',
  hfo: 'heavy fuel oil', mdo: 'marine diesel oil', lsfo: 'low sulphur fuel',
  sm: 'section modulus', cb: 'block coefficient',
};

function expandAbbreviations(q) {
  const words = q.toLowerCase().split(/\s+/);
  const extra = [];
  for (const w of words) {
    const exp = MARITIME_ABBREV[w.replace(/[^a-z]/g, '')];
    if (exp) extra.push(exp);
  }
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

// ── Domain query templates ────────────────────────────────────────────────────
const DOMAIN_QUERIES = {
  Hull:       'hull structure shell plating bulkhead framing watertight subdivision keel double bottom longitudinal transverse frame section modulus',
  Electrical: 'electrical cable switchboard generator power distribution circuit breaker transformer insulation earthing wiring voltage',
  HVAC:       'ventilation air conditioning fan duct machinery space temperature cooling heat exchanger airflow exhaust supply',
  Piping:     'piping bilge ballast fuel oil pump valve marpol discharge oily water separator pressure wall thickness',
  Mechanical: 'shaft propulsion engine gearbox bearing alignment coupling propeller vibration torsional MCR torque RPM',
  Outfit:     'naval shock qualification NSQR EMC electromagnetic NBC blast degaussing acoustic signature military combat',
};

// ── Document ingestion ────────────────────────────────────────────────────────

/**
 * Ingest a document: chunk → embed → index in BM25 + vector store.
 * Returns the number of chunks added.
 */
async function addDocument({ id, name, type, text, uploadedBy = 'system', uploadedByRole = 'system', docCategory = 'compliance' }) {
  if (docStore.has(id)) return 0;

  // Store document metadata (cap text at 2 MB to avoid memory issues)
  docStore.set(id, {
    id, name, type,
    text: text.slice(0, 2_000_000),
    addedAt: new Date().toISOString(),
    chunkCount: 0,
    pages: Math.ceil(text.length / 3000),
    uploadedBy,
    uploadedByRole,
    docCategory,
  });

  const rawChunks = chunkText(text);
  const valid     = rawChunks.filter(c => c.wordCount >= 15);
  if (!valid.length) return 0;

  // Batch-embed all chunk texts
  let vecs;
  try {
    vecs = await embedBatch(valid.map(c => c.text));
  } catch (err) {
    console.warn(`[RAG] Embedding failed for "${name}": ${err.message} — BM25-only for this doc`);
    vecs = valid.map(() => null);
  }

  for (let i = 0; i < valid.length; i++) {
    const chunkId = `${id}~~${i}`;
    const meta    = {
      id:        chunkId,
      docId:     id,
      docName:   name,
      source:    name,
      type:      type || '',
      section:   valid[i].section || '',
      text:      valid[i].text,
      wordCount: valid[i].wordCount,
    };
    chunkStore.set(chunkId, meta);
    bm25.add(chunkId, valid[i].text);
    if (vecs[i]) {
      vecStore.add(chunkId, vecs[i], { docId: id, type: type || '', section: valid[i].section || '' });
    }
  }

  docStore.get(id).chunkCount = valid.length;
  return valid.length;
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

function rrfFuse(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach(({ id }, rank) => {
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

/**
 * Hybrid BM25 + semantic retrieval with RRF fusion and MMR diversity.
 *
 * @param {string}   query
 * @param {number}   [k=6]       Number of results
 * @param {Object}   [opts]
 * @param {string}   [opts.domain]   Domain name for query expansion
 * @param {Function} [opts.filter]   Vector store metadata filter fn
 */
async function retrieve(query, k = 6, opts = {}) {
  if (!chunkStore.size || !query?.trim()) return [];

  const { domain, filter } = opts;

  // Expand abbreviations + domain context for BM25 (keyword) leg
  const bm25Query = expandAbbreviations(
    domain ? `${query} ${DOMAIN_QUERIES[domain] || ''}` : query
  );

  // ── BM25 leg ───────────────────────────────────────────────────────────────
  const bm25Hits = bm25.search(bm25Query, k * 5);

  // ── Semantic leg ───────────────────────────────────────────────────────────
  let vecHits = [];
  try {
    const qVec = await embedOne(query);   // use original (unexpanded) for semantics
    if (qVec) vecHits = vecStore.knn(qVec, k * 5, filter || null);
  } catch { /* fall through to BM25-only */ }

  // ── RRF fusion ─────────────────────────────────────────────────────────────
  const fused = vecHits.length
    ? rrfFuse([bm25Hits, vecHits])
    : bm25Hits.map(r => ({ id: r.id, score: r.score }));

  // ── Resolve chunks with vector for MMR ────────────────────────────────────
  const candidates = fused
    .map(r => {
      const c = chunkStore.get(r.id);
      if (!c) return null;
      return { ...c, score: r.score, vec: vecStore.getVec(r.id) };
    })
    .filter(Boolean);

  // ── MMR diversity pass (λ=0.65: slight diversity preference) ──────────────
  const diverse = mmrSelect(candidates, k, 0.65);

  return diverse.map(c => ({
    source:  c.source,
    section: c.section,
    type:    c.type,
    text:    c.text,
    score:   +((c.score || 0).toFixed(4)),
    docId:   c.docId,
  }));
}

/**
 * Domain-aware retrieval using pre-built domain query templates.
 */
async function retrieveForDomain(domain, k = 8) {
  const query = DOMAIN_QUERIES[domain] || domain;
  return retrieve(query, k, { domain });
}

/**
 * Multi-query retrieval: run several queries, fuse results, apply MMR.
 * Useful for complex questions that span multiple topics.
 */
async function retrieveMulti(queries, k = 6, opts = {}) {
  if (!queries.length) return [];

  const allResults = await Promise.all(
    queries.map(q => retrieve(q, k * 2, opts))
  );

  // Flatten, dedupe by chunk id, keep highest score
  const seen   = new Map();
  const merged = [];
  for (const results of allResults) {
    for (const r of results) {
      const prev = seen.get(r.docId + r.text.slice(0, 30));
      if (!prev || r.score > prev.score) {
        seen.set(r.docId + r.text.slice(0, 30), r);
      }
    }
  }
  for (const r of seen.values()) merged.push(r);
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, k);
}

// ── Accessors ─────────────────────────────────────────────────────────────────

function getDocText(id) {
  return docStore.get(id)?.text ?? null;
}

function getAllDocs() {
  return [...docStore.values()].map(({ id, name, type, addedAt, chunkCount, pages, uploadedBy, uploadedByRole, docCategory }) => ({
    id, name, type, addedAt, chunkCount, pages, uploadedBy, uploadedByRole, docCategory,
  }));
}

function removeDocument(docId) {
  if (!docStore.has(docId)) return false;
  const chunkIds = [...chunkStore.keys()].filter(k => k.startsWith(`${docId}~~`));
  for (const cid of chunkIds) chunkStore.delete(cid);
  bm25.remove(chunkIds);
  vecStore.remove(chunkIds);
  docStore.delete(docId);
  return true;
}

function getStatus() {
  // Intentionally omits document identities — the pre-loaded knowledge base is
  // internal to the inference engine and must not be exposed to the application.
  const userDocs = [...docStore.values()].filter(d => d.uploadedBy !== 'system');
  return {
    ready:          _kbReady,
    documents:      docStore.size,
    chunks:         chunkStore.size,
    vectorsIndexed: vecStore.size,
    bm25Indexed:    bm25.size,
    userDocuments:  userDocs.length,
  };
}

// ── Static knowledge-base initialisation ──────────────────────────────────────

// ── Static knowledge-base documents (server/docs/) ───────────────────────────
// The application's entire built-in knowledge base is exactly these four
// reference documents in server/docs. Everything else must be uploaded by the
// user and is only used for that session — nothing else is pre-ingested.
const KB_DOC_META = {
  'SOLAS CONSOLIDATED-20 (1).pdf':                                   { id: 'STATIC-SOLAS',      name: 'SOLAS Consolidated Edition 2020',               type: 'IMO',        docCategory: 'compliance' },
  'Life-Safing Appliances including LSA Code. 2010 Edition (1).pdf': { id: 'STATIC-LSA',        name: 'Life-Saving Appliances & LSA Code 2010',        type: 'IMO',        docCategory: 'compliance' },
  'main_rules_july_2024-edition.pdf':                                { id: 'STATIC-MAIN-RULES', name: 'Main Classification Rules — July 2024 Edition',  type: 'Class Rule', docCategory: 'compliance' },
  'BUILD SPECIFICATION  - input file.pdf':                           { id: 'STATIC-BUILD-SPEC', name: 'Build Specification — Input File',               type: 'Build Spec', docCategory: 'compliance' },
};

async function ingestDir(dir, pdfParse, defaultCategory) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f));
  let total = 0;
  for (const file of files) {
    const meta = KB_DOC_META[file] || {
      id:          'STATIC-' + file.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toUpperCase().replace(/\.PDF-?$/, ''),
      name:        file.replace(/\.pdf$/i, ''),
      type:        'Technical',
      docCategory: defaultCategory,
    };
    if (docStore.has(meta.id)) continue;            // already indexed (dedupe across dirs)
    try {
      const buffer = fs.readFileSync(path.join(dir, file));
      const data   = await pdfParse(buffer);
      const text   = data.text || '';
      if (!text.trim()) {
        console.warn(`[RAG] No text layer in "${file}" — skipped for KB (still usable via vision in modules)`);
        continue;
      }
      const n = await addDocument({ ...meta, text, uploadedBy: 'system', uploadedByRole: 'system' });
      total += n;
      console.log(`[RAG] "${meta.name}" → ${n} chunks`);
    } catch (err) {
      console.warn(`[RAG] Skipped "${file}": ${err.message}`);
    }
  }
  return total;
}

async function initializeKnowledgeBase() {
  const pdfParse = require('pdf-parse');
  const docsDir  = path.join(__dirname, '..', 'docs');

  let total = 0;
  // The built-in knowledge base is ONLY the reference documents in server/docs.
  // All other documents (HSL repository, vendor docs, etc.) must be uploaded by
  // the user and are used per-session — they are never pre-ingested into the KB.
  total += await ingestDir(docsDir, pdfParse, 'compliance');

  _kbReady = true;
  flushCache();
  console.log(`[RAG] Ready — ${docStore.size} docs | ${total} chunks | ${vecStore.size} vectors | ${bm25.size} BM25 docs`);
}

module.exports = {
  addDocument,
  removeDocument,
  getDocText,
  retrieve,
  retrieveForDomain,
  retrieveMulti,
  getAllDocs,
  getStatus,
  initializeKnowledgeBase,
};
