
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PDF helpers (pure — no AI):
//   - extractPdfPageTexts(buffer)        → [{ page, text }]  per-page embedded text
//   - rasterizePdfToPngs(buffer, opts)   → [{ page, data }]  page images (base64 PNG)
// Used so that pages WITHOUT a usable text layer can be handed to the vision
// model as images for information extraction.
//
// Rasterisation uses mupdf — a pure-WASM renderer with NO native binaries, so it
// behaves identically on every OS (Windows dev box ↔ Linux host). Text-layer
// extraction uses pdf.js. Neither needs a platform-specific build step.
// ─────────────────────────────────────────────────────────────────────────────

// ── mupdf loader (WASM PDF renderer, lazy singleton) ──────────────────────────
let _mupdf = null;
let _mupdfLogged = false;
async function getMupdf() {
  if (_mupdf) return _mupdf;
  try {
    _mupdf = await import('mupdf');          // ESM module → dynamic import from CJS
  } catch (err) {
    if (!_mupdfLogged) {
      console.error('[rasterize] mupdf (WASM PDF renderer) failed to load — scanned / image-only PDF pages cannot be rendered for OCR. Detail: ' + err.message);
      _mupdfLogged = true;
    }
    _mupdf = null;
  }
  return _mupdf;
}

// ── pdf.js loader (text-layer extraction only) ────────────────────────────────
let _pdfjs = null;
async function getPdfjs() {
  if (!_pdfjs) {
    // pdfjs ships as ESM; load it from CommonJS via dynamic import.
    _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    try { _pdfjs.GlobalWorkerOptions.workerSrc = null; } catch (_) { /* run on main thread */ }
  }
  return _pdfjs;
}

async function loadDocument(buffer) {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,   // VerbosityLevel.ERRORS — silence per-glyph font warnings
  }).promise;
}

/** Extract the embedded text layer for each page. */
async function extractPdfPageTexts(buffer) {
  const doc = await loadDocument(buffer);
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    let text = '';
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text = content.items.map(it => (it.str || '')).join(' ').replace(/\s+/g, ' ').trim();
    } catch (_) { /* leave empty → vision fallback */ }
    out.push({ page: i, text });
  }
  try { await doc.destroy(); } catch (_) {}
  return out;
}

function safeDestroy(obj) {
  try { if (obj && typeof obj.destroy === 'function') obj.destroy(); } catch (_) { /* ignore */ }
}

/**
 * Render PDF pages to PNG images (base64, no data: prefix) using mupdf (WASM).
 * @param {Buffer} buffer
 * @param {Object} [opts]
 * @param {number[]} [opts.pages]   1-based page numbers to render (default: all, capped)
 * @param {number}   [opts.maxPages] hard cap on number of pages rendered (default 12)
 * @param {number}   [opts.scale]   render scale (default 2.0 — good legibility for OCR)
 */
async function rasterizePdfToPngs(buffer, { pages, maxPages = 12, scale } = {}) {
  const mupdf = await getMupdf();
  if (!mupdf) return [];                     // already logged the reason in getMupdf()
  // Render scale: lower it (env EXTRACT_RENDER_SCALE) on memory-tight hosts where
  // large drawing pages can exhaust RAM during rasterisation.
  if (scale == null) scale = parseFloat(process.env.EXTRACT_RENDER_SCALE || '2.0');

  let doc;
  try {
    doc = mupdf.Document.openDocument(new Uint8Array(buffer), 'application/pdf');
  } catch (err) {
    console.warn('[rasterize] could not open PDF:', err.message);
    return [];
  }

  const numPages = doc.countPages();
  let target = pages && pages.length
    ? pages.filter(p => p >= 1 && p <= numPages)
    : Array.from({ length: numPages }, (_, i) => i + 1);
  target = target.slice(0, maxPages);

  const matrix = mupdf.Matrix.scale(scale, scale);
  const out = [];
  for (const p of target) {
    let page, pix;
    try {
      page = doc.loadPage(p - 1);            // mupdf page indices are 0-based
      pix  = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
      out.push({ page: p, data: Buffer.from(pix.asPNG()).toString('base64') });
    } catch (err) {
      console.warn(`[rasterize] page ${p} could not be rendered:`, err.message);
    } finally {
      safeDestroy(pix);
      safeDestroy(page);                      // free WASM memory promptly
    }
  }
  safeDestroy(doc);
  return out;
}

// True if the WASM renderer is installed — i.e. scanned-PDF OCR can run.
// Pure-WASM, so this is platform-independent (no per-OS native binary to miss).
// Used by /api/health and the extractor's diagnostics.
function isRendererAvailable() {
  try { require.resolve('mupdf'); return true; } catch (_) { return false; }
}

module.exports = { extractPdfPageTexts, rasterizePdfToPngs, isRendererAvailable };
