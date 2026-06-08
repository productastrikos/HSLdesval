'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Shared document text extractor
//   PDF (text + scanned/image fallback via Gemini) · DOCX · images · plain text
// Used by upload, convert, chat-extract, and the feature modules.
// ─────────────────────────────────────────────────────────────────────────────

const { getModel } = require('./llm');

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
]);

async function extractFileText(buffer, mime, origName = '') {
  const isPDF  = mime === 'application/pdf'  || /\.pdf$/i.test(origName);
  const isDOCX = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(origName);
  const isImg  = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(origName);

  if (isPDF) {
    let text = '';
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = (data.text || '').trim();
    } catch (_) { /* ignore — fall back to vision */ }

    // Scanned / image-only PDF — fall back to Gemini vision OCR
    if (text.length < 200) {
      const base64 = buffer.toString('base64');
      const model  = getModel();
      const result = await model.generateContent([
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        'Extract ALL text from this document exactly as it appears, including text inside images, figures, tables, and diagrams. Preserve structure using line breaks. Output only the extracted text — no commentary.',
      ]);
      text = result.response.text();
    }
    return text;
  }

  if (isDOCX) {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (isImg) {
    const imgMime = IMAGE_MIMES.has(mime) ? mime : 'image/jpeg';
    const base64  = buffer.toString('base64');
    const model   = getModel();
    const result  = await model.generateContent([
      { inlineData: { mimeType: imgMime, data: base64 } },
      'Extract all visible text from this image exactly as it appears. Preserve layout using line breaks. Output only the extracted text with no commentary.',
    ]);
    return result.response.text();
  }

  return buffer.toString('utf8');
}

module.exports = { extractFileText, IMAGE_MIMES };
