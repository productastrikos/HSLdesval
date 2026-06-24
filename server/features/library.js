'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-loaded Document Library
// A curated set of the HSL documents, parsed once and offered to EVERY module so
// nothing has to be uploaded during a live demo. The client caches these in the
// browser document store, after which they appear in every document picker.
//
//   - GET /api/library            → { docs:[{id,name,type,text,isDrawing,...}], ready }
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
const HSL_DIR  = path.join(__dirname, '..', '..', 'HSLdocs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const CACHE_FP = path.join(__dirname, '..', 'data', 'library-cache.json');

// id → { file, dir, name, type, isDrawing }
const MANIFEST = [
  { id: 'LIB-BUILD-SPEC', dir: DOCS_DIR, file: 'BUILD SPECIFICATION  - input file.pdf', name: 'Build Specification (input)',          type: 'Build Specification', isDrawing: false },
  { id: 'LIB-SOTR-HDCS',  dir: HSL_DIR,  file: 'SOTR_HDCS (1) (1).pdf',                  name: 'SOTR — HDCS',                          type: 'SOTR',              isDrawing: false },
  { id: 'LIB-SOTR-DGPS',  dir: HSL_DIR,  file: 'EED-56-02 SOTR DGPS (1).pdf',            name: 'SOTR — DGPS (EED-56-02)',              type: 'SOTR',              isDrawing: false },
  { id: 'LIB-SPEC-EMLOG', dir: HSL_DIR,  file: 'EED-56-03, EM LOG (COTS) - NOV 2006 (1).pdf', name: 'Specification — EM Log (EED-56-03)', type: 'SOTR',         isDrawing: false },
  { id: 'LIB-POTS-MBSRE', dir: HSL_DIR,  file: 'MBSRE_POTS_DSVs.pdf',                    name: 'POTS — MB/SRE (DSVs)',                 type: 'POTS',              isDrawing: false },
  { id: 'LIB-OFFER-HDCS', dir: HSL_DIR,  file: 'Technical offer of HDCS.pdf',            name: 'Technical Offer — HDCS',               type: 'Technical Offer',   isDrawing: false },
  { id: 'LIB-COMPLY-HDCS',dir: HSL_DIR,  file: 'Technical_Compliance_HDCS.pdf',          name: 'Technical Compliance Matrix — HDCS',   type: 'Compliance Matrix', isDrawing: false },
  { id: 'LIB-BINDING',    dir: HSL_DIR,  file: 'binding data.pdf',                       name: 'Binding Data (vendor)',                type: 'Binding Data',      isDrawing: false },
  { id: 'LIB-SLD-MBSRE',  dir: HSL_DIR,  file: 'SLD_MB_SRE System-VC11190-91 Model.pdf', name: 'SLD — MB/SRE System (VC11190-91)',     type: 'Drawing',           isDrawing: true },
  { id: 'LIB-BINDING-DWG',dir: HSL_DIR,  file: '01 BINDING DWG.pdf',                     name: 'Binding Drawing (GA)',                 type: 'Drawing',           isDrawing: true },
  { id: 'LIB-DWG-EED5013',dir: HSL_DIR,  file: '68 EED-50-13-R1 (1).pdf',                name: 'Drawing — EED-50-13-R1',               type: 'Drawing',           isDrawing: true },
];

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
