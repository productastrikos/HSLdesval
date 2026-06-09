'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PDF helpers (pure — no AI):
//   - extractPdfPageTexts(buffer)        → [{ page, text }]  per-page embedded text
//   - rasterizePdfToPngs(buffer, opts)   → [{ page, data }]  page images (base64 PNG)
// Used so that pages WITHOUT a usable text layer can be handed to the vision
// model as images for information extraction.
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Render PDF pages to PNG images (base64, no data: prefix).
 * @param {Buffer} buffer
 * @param {Object} [opts]
 * @param {number[]} [opts.pages]   1-based page numbers to render (default: all, capped)
 * @param {number}   [opts.maxPages] hard cap on number of pages rendered (default 12)
 * @param {number}   [opts.scale]   render scale (default 2.0 — good legibility for OCR)
 */
async function rasterizePdfToPngs(buffer, { pages, maxPages = 12, scale = 2.0 } = {}) {
  const { createCanvas } = require('@napi-rs/canvas');
  const doc = await loadDocument(buffer);

  let target = pages && pages.length
    ? pages.filter(p => p >= 1 && p <= doc.numPages)
    : Array.from({ length: doc.numPages }, (_, i) => i + 1);
  target = target.slice(0, maxPages);

  const out = [];
  for (const p of target) {
    try {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      out.push({ page: p, data: canvas.toBuffer('image/png').toString('base64') });
    } catch (_) { /* skip unrenderable page */ }
  }
  try { await doc.destroy(); } catch (_) {}
  return out;
}

module.exports = { extractPdfPageTexts, rasterizePdfToPngs };
