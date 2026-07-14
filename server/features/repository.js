'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Persistent Shared Document Repository  (/api/repository)
//
// Satisfies the spec's "upload any number of documents without any restriction"
// (§2m) and the requirement for a persistent, intranet-hosted document repository
// (§2d) — as opposed to the per-session, browser-only store that is cleared on
// logout.
//
// Documents saved here live on the server's disk. They:
//   • persist across sessions and restarts,
//   • are shared across all authenticated users (a true departmental repository),
//   • have NO count limit and (with MAX_UPLOAD_MB=0) no size limit.
//
// Storage layout (all under server/data/repository/):
//   index.json        — array of metadata records (no text, kept small/fast)
//   <id>.txt          — the extracted text for one document (may be large)
//
// Only the extracted text is retained (that is what every downstream tool — RAG,
// compliance, converter, BOM, chat — consumes). Raw binaries are not stored, so a
// scanned drawing keeps its extracted/OCR'd text but not its pixels.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const { extractFileText } = require('../lib/extract');
const { classifyDocType } = require('../lib/classify');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');

const router  = express.Router();
const REPO_DIR   = path.join(__dirname, '..', 'data', 'repository');
const INDEX_FILE = path.join(REPO_DIR, 'index.json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// ── Disk helpers ──────────────────────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(REPO_DIR)) fs.mkdirSync(REPO_DIR, { recursive: true });
}

function readIndex() {
  ensureDir();
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch (_) { return []; }
}

function writeIndex(records) {
  ensureDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(records, null, 2));
}

function textPath(id) { return path.join(REPO_DIR, `${id}.txt`); }

function readText(id) {
  try { return fs.readFileSync(textPath(id), 'utf8'); } catch (_) { return ''; }
}

// ── GET /api/repository  → metadata list (optionally filtered) ────────────────
router.get('/', (req, res) => {
  try {
    const { q = '', type = '', project = '' } = req.query;
    let docs = readIndex();
    if (q)       docs = docs.filter(d => (d.name || '').toLowerCase().includes(String(q).toLowerCase()));
    if (type)    docs = docs.filter(d => d.type === type);
    if (project) docs = docs.filter(d => (d.project || '') === project);
    res.json({ docs, total: docs.length });
  } catch (err) {
    console.error('[/api/repository GET]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── GET /api/repository/:id  → full record including extracted text ───────────
router.get('/:id', (req, res) => {
  try {
    const doc = readIndex().find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found in the repository.' });
    res.json({ ...doc, text: readText(doc.id) });
  } catch (err) {
    console.error('[/api/repository/:id GET]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/repository  → upload → extract → classify → persist ─────────────
// Multipart: file (required), project?, discipline?
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const name = req.body.docName || req.file.originalname;
    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not read this file. It may be empty, password-protected, or a corrupted/incomplete PDF.' });
    }

    const type = await classifyDocType(text, name);
    const id   = 'REPO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    const record = {
      id,
      name,
      type,
      mime:       req.file.mimetype,
      pages:      Math.ceil(text.length / 3000),
      textLength: text.length,
      sizeBytes:  req.file.size,
      project:    (req.body.project || 'Unassigned').trim() || 'Unassigned',
      discipline: req.body.discipline || '',
      uploadedBy: req.user?.username || 'system',
      addedAt:    new Date().toISOString(),
    };

    // Persist text separately (may be large), then prepend metadata to the index.
    ensureDir();
    fs.writeFileSync(textPath(id), text);
    const records = readIndex();
    records.unshift(record);
    writeIndex(records);

    // Return the text too, so the caller can also seed its in-session picker
    // without a second round-trip.
    res.status(201).json({ ...record, text });
  } catch (err) {
    console.error('[/api/repository POST]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── DELETE /api/repository/:id  → admin (any) or owner (own) ──────────────────
router.delete('/:id', (req, res) => {
  try {
    const records = readIndex();
    const doc = records.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found in the repository.' });
    if (req.user.role !== 'admin' && doc.uploadedBy !== req.user.username) {
      return res.status(403).json({ error: 'You can only delete documents you uploaded.' });
    }
    writeIndex(records.filter(d => d.id !== req.params.id));
    try { fs.unlinkSync(textPath(doc.id)); } catch (_) {}
    res.json({ success: true, id: doc.id });
  } catch (err) {
    console.error('[/api/repository/:id DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
