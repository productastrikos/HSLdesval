'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-loaded Document Library
// Intentionally EMPTY. The application's only built-in documents are the four
// reference files in server/docs, which form the background knowledge base
// (see server/rag). Every other document must be uploaded by the user and is
// used per-session — nothing is pre-loaded into the module document pickers.
//
//   - GET /api/library            → { docs:[], ready }
// resolveLibraryFile(id) → { path, name, mime }  (whitelisted; used by Drawing
// Intelligence to read a pre-loaded drawing's raw bytes server-side for vision).
//
// Extracted text is cached to server/data/library-cache.json (keyed by file
// size+mtime) so only the first call pays the parsing/OCR cost.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const fs   = require('fs');
const path = require('path');

const { extractFileText } = require('../lib/extract');
const { mapLimit } = require('./_util');

const router  = express.Router();
const CACHE_FP = path.join(__dirname, '..', 'data', 'library-cache.json');

// id → { file, dir, name, type, isDrawing }
// Empty by design — no documents are pre-loaded. Users upload everything they
// need; only the four server/docs reference files act as the built-in KB.
const MANIFEST = [];

function manifestPath(entry) { return path.join(entry.dir, entry.file); }

function sigOf(fp) {
  try { const s = fs.statSync(fp); return `${s.size}:${Math.round(s.mtimeMs)}`; }
  catch (_) { return ''; }
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FP, 'utf8')); } catch (_) { return {}; }
}
function writeCache(cache) {
  try { fs.writeFileSync(CACHE_FP, JSON.stringify(cache, null, 2)); } catch (_) {}
}

// Extract one library document's text, using the disk cache when fresh.
async function loadDoc(entry, cache) {
  const fp  = manifestPath(entry);
  if (!fs.existsSync(fp)) return { ...entry, text: '', note: 'File not found on server.' };
  const sig = sigOf(fp);
  if (cache[entry.id] && cache[entry.id].sig === sig) {
    return { ...entry, text: cache[entry.id].text || '', note: cache[entry.id].note || '' };
  }
  let text = '', note = '';
  try {
    const buffer = fs.readFileSync(fp);
    if (entry.isDrawing) {
      // Drawings are read on demand by Drawing Intelligence (server-side vision on
      // the raw file). Here we only grab a cheap text layer if one exists.
      try { const d = await require('pdf-parse')(buffer); text = (d.text || '').trim(); } catch (_) { text = ''; }
      note = 'Drawing — open in Drawing Intelligence for vision-based extraction.';
    } else {
      text = await extractFileText(buffer, 'application/pdf', entry.file);
    }
  } catch (err) {
    note = `Could not parse: ${err.message}`;
  }
  cache[entry.id] = { sig, text, note };
  return { ...entry, text, note };
}

// GET /api/library
router.get('/', async (req, res) => {
  try {
    const cache = readCache();
    const docs = await mapLimit(MANIFEST, 3, e => loadDoc(e, cache).catch(() => ({ ...e, text: '', note: 'parse error' })));
    writeCache(cache);
    res.json({
      ready: true,
      docs: docs.map(d => ({
        id: d.id, name: d.name, type: d.type, isDrawing: !!d.isDrawing,
        libraryFile: d.id, mime: 'application/pdf',
        text: d.text || '', textLength: (d.text || '').length, note: d.note || '',
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// Whitelisted path resolver (prevents traversal — only manifest ids are valid).
function resolveLibraryFile(id) {
  const entry = MANIFEST.find(e => e.id === id);
  if (!entry) return null;
  const fp = manifestPath(entry);
  if (!fs.existsSync(fp)) return null;
  return { path: fp, name: entry.file, mime: 'application/pdf' };
}

module.exports = { router, resolveLibraryFile, MANIFEST };
