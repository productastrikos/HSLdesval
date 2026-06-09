'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Shared document text extractor
//   PDF (per-page text layer; pages with no text → page image → vision model)
//   · DOCX · images (vision) · plain text
// Used by upload, convert, chat-extract, and the feature modules.
// ─────────────────────────────────────────────────────────────────────────────

const { getModel } = require('./llm');
const { extractPdfPageTexts, rasterizePdfToPngs } = require('./rasterize');

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
]);

// A page with fewer than this many characters of embedded text is treated as
// scanned / image-only and routed to the vision model.
const MIN_PAGE_TEXT_CHARS = 80;
// Safety cap on how many image-only pages we OCR per document.
const MAX_VISION_PAGES = parseInt(process.env.EXTRACT_MAX_VISION_PAGES || '20', 10);

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
    const parts = [];
    for (const pg of pngs) parts.push(await ocrImage(pg.data).catch(() => ''));
    return parts.filter(Boolean).join('\n\n');
  }

  // Identify pages that need vision (no usable text layer).
  const needVision = pageTexts.filter(p => p.text.length < MIN_PAGE_TEXT_CHARS).map(p => p.page);
  const visionPages = needVision.slice(0, MAX_VISION_PAGES);

  const ocrByPage = new Map();
  if (visionPages.length) {
    const pngs = await rasterizePdfToPngs(buffer, { pages: visionPages, maxPages: MAX_VISION_PAGES }).catch(() => []);
    for (const pg of pngs) {
      const txt = await ocrImage(pg.data).catch(() => '');
      if (txt) ocrByPage.set(pg.page, txt);
    }
  }

  // Reassemble in page order, preferring the text layer, then OCR.
  const out = [];
  for (const p of pageTexts) {
    if (p.text.length >= MIN_PAGE_TEXT_CHARS) out.push(p.text);
    else if (ocrByPage.has(p.page))           out.push(ocrByPage.get(p.page));
  }
  return out.join('\n\n').trim();
}

async function extractFileText(buffer, mime, origName = '') {
  const isPDF  = mime === 'application/pdf' || /\.pdf$/i.test(origName);
  const isDOCX = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(origName);
  const isImg  = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(origName);

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

module.exports = { extractFileText, IMAGE_MIMES };
