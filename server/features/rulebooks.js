'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Rule-Book Management with Version Control  (/api/rulebooks, admin only)
//
// Satisfies spec §3e-i: "Upload, update or delete rule books or documents based
// on version control."
//
// An admin can:
//   • upload a rule book (creates v1),
//   • upload a new version of an existing rule book (v2, v3 … — supersedes the
//     previous active version but keeps the full history),
//   • roll back to (activate) any earlier version,
//   • delete a single version, or the whole rule book.
//
// The ACTIVE version of each rule book is ingested into the RAG knowledge base,
// so every query is answered against the currently-approved edition. Superseded
// versions are retained on disk for audit/rollback but are not searched.
//
// Storage (server/data/rulebooks/):
//   index.json          — array of rule-book records (metadata + version history)
//   <bookId>-v<n>.txt   — extracted text of one version
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const rag = require('../rag');
const { extractFileText } = require('../lib/extract');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');

const router  = express.Router();
const RB_DIR    = path.join(__dirname, '..', 'data', 'rulebooks');
const INDEX_FILE = path.join(RB_DIR, 'index.json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const CATEGORIES = ['Class Rule', 'IMO', 'IEC', 'IEEE', 'Naval / NSQR', 'Build Specification', 'Standard', 'Rule Book'];

// ── Disk helpers ──────────────────────────────────────────────────────────────
function ensureDir() { if (!fs.existsSync(RB_DIR)) fs.mkdirSync(RB_DIR, { recursive: true }); }
function readIndex() { ensureDir(); try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) { return []; } }
function writeIndex(recs) { ensureDir(); fs.writeFileSync(INDEX_FILE, JSON.stringify(recs, null, 2)); }
function textPath(id, v) { return path.join(RB_DIR, `${id}-v${v}.txt`); }
function readText(id, v) { try { return fs.readFileSync(textPath(id, v), 'utf8'); } catch (_) { return ''; } }

// Deterministic RAG document id for a rule-book version.
function ragId(id, v) { return `RULEBOOK-${id}-v${v}`; }

// Strip text/version payloads from a record for list responses.
function publicView(book) {
  return {
    id: book.id, name: book.name, category: book.category,
    activeVersion: book.activeVersion,
    versionCount: book.versions.length,
    createdAt: book.createdAt, updatedAt: book.updatedAt, createdBy: book.createdBy,
    versions: book.versions.map(v => ({
      version: v.version, fileName: v.fileName, pages: v.pages, textLength: v.textLength,
      sizeBytes: v.sizeBytes, uploadedBy: v.uploadedBy, uploadedAt: v.uploadedAt, note: v.note || '',
      active: v.version === book.activeVersion,
    })),
  };
}

// ── RAG ingestion ─────────────────────────────────────────────────────────────
// Make the book's active version the one (and only) edition searched by the KB.
async function ingestActive(book) {
  for (const v of book.versions) rag.removeDocument(ragId(book.id, v.version));   // clear all editions
  const active = book.versions.find(v => v.version === book.activeVersion);
  if (!active) return;
  const text = readText(book.id, active.version);
  if (!text.trim()) return;
  await rag.addDocument({
    id: ragId(book.id, active.version),
    name: `${book.name} (v${active.version})`,
    type: book.category,
    text,
    uploadedBy: 'system', uploadedByRole: 'system', docCategory: 'compliance',
  });
}

function dropFromRag(book) {
  for (const v of book.versions) rag.removeDocument(ragId(book.id, v.version));
}

// Re-ingest every rule book's active version at server boot (RAG is in-memory and
// rebuilt on start; disk-persisted rule books must be re-indexed).
async function reindexAll() {
  const books = readIndex();
  for (const b of books) {
    try { await ingestActive(b); } catch (err) { console.warn(`[RuleBooks] reindex "${b.name}" failed: ${err.message}`); }
  }
  if (books.length) console.log(`[RuleBooks] Re-indexed ${books.length} rule book(s) into the knowledge base`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/rulebooks → list (metadata + version history)
router.get('/', (req, res) => {
  try {
    res.json({ categories: CATEGORIES, books: readIndex().map(publicView) });
  } catch (err) {
    console.error('[/api/rulebooks GET]', err.message);
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
  }
});

// GET /api/rulebooks/:id → one rule book
router.get('/:id', (req, res) => {
  const book = readIndex().find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: 'Rule book not found.' });
  res.json(publicView(book));
});

// GET /api/rulebooks/:id/versions/:v/text → extracted text of a version (preview)
router.get('/:id/versions/:v/text', (req, res) => {
  const book = readIndex().find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: 'Rule book not found.' });
  const v = parseInt(req.params.v, 10);
  if (!book.versions.some(x => x.version === v)) return res.status(404).json({ error: 'Version not found.' });
  res.json({ id: book.id, version: v, text: readText(book.id, v) });
});

// POST /api/rulebooks → create a rule book (v1). Multipart: file, name?, category?
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) return res.status(422).json({ error: 'Could not read this file. It may be empty, password-protected, or a corrupted/incomplete PDF.' });

    const id       = 'RB-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Rule Book';
    const now      = new Date().toISOString();
    const version  = {
      version: 1, fileName: req.file.originalname, pages: Math.ceil(text.length / 3000),
      textLength: text.length, sizeBytes: req.file.size, uploadedBy: req.user?.username || 'admin',
      uploadedAt: now, note: req.body.note || 'Initial version',
    };
    const book = {
      id, name: (req.body.name || req.file.originalname.replace(/\.[^/.]+$/, '')).trim(),
      category, activeVersion: 1, createdAt: now, updatedAt: now,
      createdBy: req.user?.username || 'admin', versions: [version],
    };

    ensureDir();
    fs.writeFileSync(textPath(id, 1), text);
    const books = readIndex(); books.unshift(book); writeIndex(books);
    await ingestActive(book);
    res.status(201).json(publicView(book));
  } catch (err) {
    console.error('[/api/rulebooks POST]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// POST /api/rulebooks/:id/versions → add a new version (becomes active)
router.post('/:id/versions', upload.single('file'), async (req, res) => {
  try {
    const books = readIndex();
    const book  = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'Rule book not found.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) return res.status(422).json({ error: 'Could not read this file. It may be empty, password-protected, or a corrupted/incomplete PDF.' });

    const nextV = Math.max(...book.versions.map(v => v.version)) + 1;
    const now   = new Date().toISOString();
    book.versions.push({
      version: nextV, fileName: req.file.originalname, pages: Math.ceil(text.length / 3000),
      textLength: text.length, sizeBytes: req.file.size, uploadedBy: req.user?.username || 'admin',
      uploadedAt: now, note: req.body.note || `Version ${nextV}`,
    });
    book.activeVersion = nextV;   // newest version becomes active
    book.updatedAt = now;
    if (req.body.category && CATEGORIES.includes(req.body.category)) book.category = req.body.category;

    fs.writeFileSync(textPath(book.id, nextV), text);
    writeIndex(books);
    await ingestActive(book);
    res.status(201).json(publicView(book));
  } catch (err) {
    console.error('[/api/rulebooks/:id/versions POST]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// PATCH /api/rulebooks/:id/activate → roll back / activate a specific version
router.patch('/:id/activate', express.json(), async (req, res) => {
  try {
    const books = readIndex();
    const book  = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'Rule book not found.' });
    const v = parseInt(req.body.version, 10);
    if (!book.versions.some(x => x.version === v)) return res.status(400).json({ error: 'That version does not exist.' });

    book.activeVersion = v;
    book.updatedAt = new Date().toISOString();
    writeIndex(books);
    await ingestActive(book);
    res.json(publicView(book));
  } catch (err) {
    console.error('[/api/rulebooks/:id/activate]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// DELETE /api/rulebooks/:id/versions/:v → delete one version
router.delete('/:id/versions/:v', async (req, res) => {
  try {
    const books = readIndex();
    const book  = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'Rule book not found.' });
    const v = parseInt(req.params.v, 10);
    if (book.versions.length <= 1) return res.status(400).json({ error: 'Cannot delete the only version. Delete the rule book instead.' });
    if (!book.versions.some(x => x.version === v)) return res.status(404).json({ error: 'Version not found.' });

    rag.removeDocument(ragId(book.id, v));
    book.versions = book.versions.filter(x => x.version !== v);
    try { fs.unlinkSync(textPath(book.id, v)); } catch (_) {}
    // If we removed the active version, activate the latest remaining one.
    if (book.activeVersion === v) book.activeVersion = Math.max(...book.versions.map(x => x.version));
    book.updatedAt = new Date().toISOString();
    writeIndex(books);
    await ingestActive(book);
    res.json(publicView(book));
  } catch (err) {
    console.error('[/api/rulebooks/:id/versions DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// DELETE /api/rulebooks/:id → delete the whole rule book (all versions)
router.delete('/:id', (req, res) => {
  try {
    const books = readIndex();
    const book  = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'Rule book not found.' });

    dropFromRag(book);
    for (const v of book.versions) { try { fs.unlinkSync(textPath(book.id, v.version)); } catch (_) {} }
    writeIndex(books.filter(b => b.id !== book.id));
    res.json({ success: true, id: book.id });
  } catch (err) {
    console.error('[/api/rulebooks/:id DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = { router, reindexAll, CATEGORIES };
