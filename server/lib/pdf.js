'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PDF document builder (pdf-lib — pure JS, no native/WASM binary)
//
// Produces a real, paginated PDF deliverable with titled tables and prose,
// mirroring the Word builder (lib/word.js) so every feature page can offer
// Excel + Word + PDF for the same data. Output is a Buffer; serve as
// application/pdf.
//
//   buildPdfDoc({ title, subtitle, blocks }) → Promise<Buffer>
//     blocks: [
//       { type: 'heading', level: 1|2|3, text },
//       { type: 'para',    text },
//       { type: 'bullet',  items: [..] },
//       { type: 'table',   columns: [..], rows: [ {col:val} | [v,..] ], caption },
//       { type: 'spacer' },
//     ]
//   buildPdfTable(title, columns, rows, subtitle)  → Promise<Buffer>
//   buildPdfFromText(title, text, subtitle)        → Promise<Buffer>
// ─────────────────────────────────────────────────────────────────────────────

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// A4 portrait, in PDF points
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const USABLE = PAGE_W - MARGIN * 2;

const NAVY = rgb(0.078, 0.188, 0.353);   // #14305a — headings / table header fill
const GREY = rgb(0.353, 0.42, 0.525);    // subtitle
const INK  = rgb(0.102, 0.102, 0.102);   // body
const LINE = rgb(0.725, 0.769, 0.839);   // cell borders
const WHITE = rgb(1, 1, 1);

// Standard PDF fonts are WinAnsi (Latin-1) only — map the unicode the model
// commonly emits to safe ASCII so pdf-lib never throws "cannot encode".
function sanitize(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[•·●▪∙]/g, '-')
    .replace(/→/g, '->').replace(/←/g, '<-')
    .replace(/⇒/g, '=>')
    .replace(/[×]/g, 'x').replace(/[÷]/g, '/')
    .replace(/[✓✔]/g, 'Y').replace(/[✗✘]/g, 'X')
    .replace(/ /g, ' ')
    .replace(/[…]/g, '...')
    // strip anything still outside the printable Latin-1 range
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
}

// Wrap a string to a pixel width, honouring existing newlines. Hard-splits
// words longer than the column.
function wrapText(text, font, size, maxWidth) {
  const out = [];
  const paras = sanitize(text).split(/\r?\n/);
  for (const para of paras) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      let w = word;
      // hard-split a single word that is wider than the column
      while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
        let cut = w.length;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        const head = w.slice(0, cut);
        if (line) { out.push(line); line = ''; }
        out.push(head);
        w = w.slice(cut);
      }
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        out.push(line); line = w;
      } else {
        line = trial;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function buildPdfDoc({ title = 'Document', subtitle = '', blocks = [] } = {}) {
  return (async () => {
    const doc  = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
    const ensure = (h) => { if (y - h < MARGIN) newPage(); };

    const drawLines = (lines, f, size, color, x = MARGIN, lh = size * 1.32, indent = 0) => {
      for (const ln of lines) {
        ensure(lh);
        page.drawText(ln, { x: x + indent, y: y - size, size, font: f, color });
        y -= lh;
      }
    };

    // Title + subtitle
    if (title) {
      const lines = wrapText(title, bold, 18, USABLE);
      drawLines(lines, bold, 18, NAVY);
      y -= 2;
    }
    if (subtitle) {
      drawLines(wrapText(subtitle, font, 10, USABLE), font, 10, GREY);
      y -= 6;
    }

    const drawTable = ({ columns = [], rows = [], caption }) => {
      if (!columns.length) return;
      const cols = columns.map(sanitize);
      const cellSize = 8.5, pad = 4, lh = cellSize * 1.28;

      if (caption) { y -= 4; drawLines(wrapText(caption, bold, 10, USABLE), bold, 10, NAVY); y -= 2; }

      // Column widths weighted by content length (capped), normalised to USABLE.
      const sample = rows.slice(0, 60);
      const weights = cols.map((c, i) => {
        let m = c.length;
        for (const r of sample) {
          const v = Array.isArray(r) ? r[i] : r[columns[i]];
          m = Math.max(m, sanitize(v).length);
        }
        return Math.min(Math.max(m, 4), 46);
      });
      const wsum = weights.reduce((a, b) => a + b, 0) || 1;
      const widths = weights.map(w => Math.max(34, (w / wsum) * USABLE));
      const adj = USABLE / widths.reduce((a, b) => a + b, 0);
      for (let i = 0; i < widths.length; i++) widths[i] *= adj;

      const drawHeader = () => {
        const cellLines = cols.map((c, i) => wrapText(c, bold, cellSize, widths[i] - pad * 2));
        const rowH = Math.max(...cellLines.map(l => l.length)) * lh + pad * 2;
        ensure(rowH);
        let x = MARGIN;
        for (let i = 0; i < cols.length; i++) {
          page.drawRectangle({ x, y: y - rowH, width: widths[i], height: rowH, color: NAVY });
          let ty = y - pad - cellSize;
          for (const ln of cellLines[i]) { page.drawText(ln, { x: x + pad, y: ty, size: cellSize, font: bold, color: WHITE }); ty -= lh; }
          x += widths[i];
        }
        y -= rowH;
      };

      drawHeader();

      for (const r of rows) {
        const cellLines = cols.map((c, i) => {
          const v = Array.isArray(r) ? r[i] : r[columns[i]];
          return wrapText(v, font, cellSize, widths[i] - pad * 2);
        });
        const rowH = Math.max(1, ...cellLines.map(l => l.length)) * lh + pad * 2;
        if (y - rowH < MARGIN) { newPage(); drawHeader(); }
        let x = MARGIN;
        for (let i = 0; i < cols.length; i++) {
          page.drawRectangle({ x, y: y - rowH, width: widths[i], height: rowH, borderColor: LINE, borderWidth: 0.6, color: WHITE });
          let ty = y - pad - cellSize;
          for (const ln of cellLines[i]) { page.drawText(ln, { x: x + pad, y: ty, size: cellSize, font, color: INK }); ty -= lh; }
          x += widths[i];
        }
        y -= rowH;
      }
      y -= 8;
    };

    for (const b of blocks) {
      if (!b) continue;
      switch (b.type) {
        case 'heading': {
          const lvl = Math.min(Math.max(parseInt(b.level || 2, 10), 1), 3);
          const size = lvl === 1 ? 15 : lvl === 2 ? 13 : 11;
          y -= lvl <= 2 ? 8 : 5;
          drawLines(wrapText(b.text, bold, size, USABLE), bold, size, NAVY);
          y -= 2;
          break;
        }
        case 'para':
          drawLines(wrapText(b.text, font, 10, USABLE), font, 10, INK);
          y -= 4;
          break;
        case 'bullet':
          for (const it of (b.items || [])) {
            const lines = wrapText(it, font, 10, USABLE - 14);
            ensure(lines.length * 13);
            page.drawText('-', { x: MARGIN + 2, y: y - 10, size: 10, font, color: INK });
            drawLines(lines, font, 10, INK, MARGIN + 14);
          }
          y -= 4;
          break;
        case 'table':
          drawTable(b);
          break;
        case 'spacer':
          y -= 10;
          break;
        default:
          break;
      }
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  })();
}

function buildPdfTable(title, columns, rows, subtitle = '') {
  return buildPdfDoc({ title, subtitle, blocks: [{ type: 'table', columns, rows }] });
}

// ── Markdown pipe-table detection (shared grammar with lib/word.js) ───────────
const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
const splitTableRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  .map(c => c.replace(/\*\*(.+?)\*\*/g, '$1').trim());

// Convert lightweight markdown-ish prose into PDF blocks (same grammar as Word):
// # / ## / ### headings, "- " bullets, | pipe | tables, and paragraphs.
function buildPdfFromText(title, text, subtitle = '') {
  const blocks = [];
  const lines = String(text || '').split(/\r?\n/);
  let bullets = [];
  const flush = () => { if (bullets.length) { blocks.push({ type: 'bullet', items: bullets }); bullets = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\*\*(.+?)\*\*/g, '$1');

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const columns = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) {
        rows.push(splitTableRow(lines[i])); i++;
      }
      i--;
      blocks.push({ type: 'table', columns, rows });
      continue;
    }

    if (/^###\s+/.test(line))           { flush(); blocks.push({ type: 'heading', level: 3, text: line.replace(/^###\s+/, '') }); }
    else if (/^##\s+/.test(line))       { flush(); blocks.push({ type: 'heading', level: 2, text: line.replace(/^##\s+/, '') }); }
    else if (/^#\s+/.test(line))        { flush(); blocks.push({ type: 'heading', level: 1, text: line.replace(/^#\s+/, '') }); }
    else if (/^\s*[-*•]\s+/.test(line)) { bullets.push(line.replace(/^\s*[-*•]\s+/, '')); }
    else if (line.trim() === '')        { flush(); }
    else                                { flush(); blocks.push({ type: 'para', text: line }); }
  }
  flush();
  return buildPdfDoc({ title, subtitle, blocks });
}

module.exports = { buildPdfDoc, buildPdfTable, buildPdfFromText };
