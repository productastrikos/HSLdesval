'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Shared document text extractor
//   PDF (per-page text layer; pages with no text → page image → vision model)
//   · DOCX · images (vision) · plain text
// Used by upload, convert, chat-extract, and the feature modules.
// ─────────────────────────────────────────────────────────────────────────────

const { getModel } = require('./llm');
const { extractPdfPageTexts, rasterizePdfToPngs, isRendererAvailable } = require('./rasterize');
const { parseCad, isCadName } = require('./cad');

// Build a specific, actionable error when a PDF yields no text — so a deployed
// app reports the real cause instead of a blanket "could not read this file".
function readError(message, status = 422) {
  const err = new Error(message);
  err.status = status;
  return err;
}
function diagnoseEmpty(scanned) {
  if (!scanned) {
    return readError('Could not read this file. It may be empty, password-protected, or a corrupted/incomplete PDF.');
  }
  if (!isRendererAvailable()) {
    return readError('This looks like a scanned / image-only PDF, but the server\'s PDF renderer (mupdf) is unavailable, so OCR could not run. Reinstall the server dependencies on the host (cd server && npm install).');
  }
  if (!process.env.LLM_API_KEY) {
    return readError('This is a scanned / image-only PDF that needs OCR, but the AI vision engine is not configured. Set LLM_API_KEY in the deployment environment.', 503);
  }
  return readError('This is a scanned / image-only PDF and the OCR/vision step returned no text. The vision model likely errored — check the server logs for "[inference]" entries.', 502);
}

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
]);

// Page markers are injected into extracted PDF text so downstream features (pre-bid
// queries, BOM generation, clause referencing) can cite an actual page number.
// The format is stable and human-readable; prompts tell the model to read it.
const PAGE_MARK = (n) => `----- Page ${n} -----`;

// A page with fewer than this many characters of embedded text is treated as
// scanned / image-only and routed to the vision model.
const MIN_PAGE_TEXT_CHARS = 80;
// Safety cap on how many image-only pages we OCR per document. OCR is sequential
// and each page is a vision call (several seconds), so a high cap can blow past
// the host's gateway timeout. Default 10 keeps a scanned-doc upload responsive;
// raise EXTRACT_MAX_VISION_PAGES on a host with a longer timeout.
const MAX_VISION_PAGES = parseInt(process.env.EXTRACT_MAX_VISION_PAGES || '10', 10);
// OCR pages in parallel (bounded) so a multi-page scan finishes well within the
// host's gateway timeout instead of running one slow vision call at a time.
const OCR_CONCURRENCY = parseInt(process.env.EXTRACT_OCR_CONCURRENCY || '3', 10);

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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const OCR_PROMPT =
  'Extract ALL text and tabular data from this page exactly as it appears, including text inside ' +
  'images, figures, stamps, tables and diagrams. Preserve structure using line breaks. ' +
  'Output only the extracted text — no commentary.';

/** OCR a single page image (base64 PNG) via the vision model. */
async function ocrImage(base64, mimeType = 'image/png') {
  const model = getModel();
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64 } },
    OCR_PROMPT,
  ]);
  return (result.response.text() || '').trim();
}

/** Extract text from a PDF, falling back to vision for pages with no text layer. */
async function extractPdfText(buffer) {
  let pageTexts = [];
  try {
    pageTexts = await extractPdfPageTexts(buffer);
  } catch (_) {
    pageTexts = [];
  }

  // If we couldn't even enumerate pages, fall back to pdf-parse, then whole-doc vision.
  if (!pageTexts.length) {
    let text = '';
    try {
      const data = await require('pdf-parse')(buffer);
      text = (data.text || '').trim();
    } catch (_) { /* ignore */ }
    if (text.length >= MIN_PAGE_TEXT_CHARS) return text;

    const pngs = await rasterizePdfToPngs(buffer, { maxPages: MAX_VISION_PAGES }).catch(() => []);
    const parts = await mapLimit(pngs, OCR_CONCURRENCY,
      pg => ocrImage(pg.data).then(t => ({ page: pg.page, t })).catch(() => ({ page: pg.page, t: '' })));
    const ocrText = parts.filter(x => x.t).map(x => `${PAGE_MARK(x.page)}\n${x.t}`).join('\n\n').trim();
    if (ocrText) return ocrText;
    throw diagnoseEmpty(true);   // no text layer at all → treat as scanned
  }

  // Identify pages that need vision (no usable text layer).
  const needVision = pageTexts.filter(p => p.text.length < MIN_PAGE_TEXT_CHARS).map(p => p.page);
  const visionPages = needVision.slice(0, MAX_VISION_PAGES);

  const ocrByPage = new Map();
  if (visionPages.length) {
    const pngs = await rasterizePdfToPngs(buffer, { pages: visionPages, maxPages: MAX_VISION_PAGES }).catch(() => []);
    const ocrResults = await mapLimit(pngs, OCR_CONCURRENCY,
      pg => ocrImage(pg.data).then(txt => ({ page: pg.page, txt })).catch(() => ({ page: pg.page, txt: '' })));
    for (const r of ocrResults) if (r.txt) ocrByPage.set(r.page, r.txt);
  }

  // Reassemble in page order, preferring the text layer, then OCR. Each page is
  // prefixed with a page marker so features can cite real page numbers.
  const out = [];
  for (const p of pageTexts) {
    let body = '';
    if (p.text.length >= MIN_PAGE_TEXT_CHARS) body = p.text;
    else if (ocrByPage.has(p.page))           body = ocrByPage.get(p.page);
    if (body) out.push(`${PAGE_MARK(p.page)}\n${body}`);
  }
  const result = out.join('\n\n').trim();
  if (result) return result;
  // Nothing readable — most pages had no text layer → scanned document.
  throw diagnoseEmpty(needVision.length > 0);
}

async function extractFileText(buffer, mime, origName = '') {
  const isPDF  = mime === 'application/pdf' || /\.pdf$/i.test(origName);
  const isDOCX = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(origName);
  const isImg  = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(origName);
  const isCad  = isCadName(origName, mime);

  // AutoCAD drawings (.dwg / .dxf) — decode to a structured text summary (text
  // labels + computed compartment areas) so EVERY feature that reads documents
  // (upload, convert, chat, BOM, design review, inspection, …) can consume a CAD
  // drawing exactly like a PDF. Drawing Intelligence still uses the richer
  // geometry-aware path; here we just need readable text.
  if (isCad) {
    const parsed = await parseCad(buffer, origName || 'drawing');
    const summary = (parsed && parsed.summary || '').trim();
    if (summary) return summary;
    throw readError('Could not read this CAD drawing. If it is a binary .dwg that failed to decode, export it to DXF or PDF from AutoCAD and re-upload.');
  }

  if (isPDF) return extractPdfText(buffer);

  if (isDOCX) {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (isImg) {
    const imgMime = IMAGE_MIMES.has(mime) ? mime : 'image/jpeg';
    return ocrImage(buffer.toString('base64'), imgMime);
  }

  return buffer.toString('utf8');
}

module.exports = { extractFileText, IMAGE_MIMES, PAGE_MARK };
