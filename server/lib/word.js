'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Word document builder (dependency-free, Word-compatible HTML → .doc)
//
// Microsoft Word opens an HTML document carrying the Office namespaces natively
// and renders headings, paragraphs and bordered tables correctly. This gives us
// a true editable Word deliverable with NO native/binary dependency — important
// for the air-gapped Linux host. Output is a Buffer; serve as .doc with
// Content-Type application/msword.
//
//   buildWordDoc({ title, subtitle, blocks }) → Buffer
//     blocks: [
//       { type: 'heading', level: 1|2|3, text },
//       { type: 'para',    text },
//       { type: 'table',   columns: [..], rows: [ {col:val} | [v,..] ], caption },
//       { type: 'spacer' },
//     ]
//   buildWordTable(title, columns, rows)         → Buffer   (single table)
//   buildWordFromText(title, text)               → Buffer   (markdown-ish prose)
// ─────────────────────────────────────────────────────────────────────────────

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cell(v) {
  // Preserve intra-cell line breaks as <br/>
  return esc(v).replace(/\r?\n/g, '<br/>');
}

function tableHtml({ columns = [], rows = [], caption }) {
  if (!columns.length) return '';
  const head = `<tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = rows.map(r => {
    const vals = Array.isArray(r) ? columns.map((_, i) => r[i]) : columns.map(c => r[c]);
    return `<tr>${vals.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`;
  }).join('');
  const cap = caption ? `<p class="cap">${esc(caption)}</p>` : '';
  return `${cap}<table>${head}${body}</table>`;
}

function blockHtml(b) {
  if (!b) return '';
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(Math.max(parseInt(b.level || 2, 10), 1), 4);
      return `<h${lvl}>${esc(b.text)}</h${lvl}>`;
    }
    case 'para':   return `<p>${cell(b.text)}</p>`;
    case 'bullet': return `<ul>${(b.items || []).map(i => `<li>${cell(i)}</li>`).join('')}</ul>`;
    case 'table':  return tableHtml(b);
    case 'spacer': return '<p>&nbsp;</p>';
    default:       return '';
  }
}

const STYLE = `
  @page { margin: 1in; }
  body  { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }
  h1    { font-size: 18pt; color: #14305a; margin: 0 0 2pt; }
  h2    { font-size: 14pt; color: #14305a; margin: 14pt 0 4pt; border-bottom: 1px solid #c9d4e6; padding-bottom: 2pt; }
  h3    { font-size: 12pt; color: #1f3b63; margin: 10pt 0 3pt; }
  h4    { font-size: 11pt; color: #1f3b63; margin: 8pt 0 2pt; }
  p     { margin: 4pt 0; line-height: 1.35; }
  p.sub { color: #5a6b86; font-size: 10pt; margin: 0 0 8pt; }
  p.cap { font-weight: bold; margin: 8pt 0 2pt; }
  table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; }
  th    { background: #14305a; color: #ffffff; border: 1px solid #2b4a7a; padding: 5pt 7pt; text-align: left; font-size: 9.5pt; }
  td    { border: 1px solid #b9c4d6; padding: 4pt 7pt; font-size: 9.5pt; vertical-align: top; }
  ul    { margin: 4pt 0 8pt 18pt; }
`;

function buildWordDoc({ title = 'Document', subtitle = '', blocks = [] } = {}) {
  const titleHtml = title ? `<h1>${esc(title)}</h1>` : '';
  const subHtml   = subtitle ? `<p class="sub">${esc(subtitle)}</p>` : '';
  const bodyHtml  = blocks.map(blockHtml).join('\n');

  const html =
`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${STYLE}</style></head>
<body>${titleHtml}${subHtml}${bodyHtml}</body></html>`;

  return Buffer.from(html, 'utf8');
}

function buildWordTable(title, columns, rows, subtitle = '') {
  return buildWordDoc({ title, subtitle, blocks: [{ type: 'table', columns, rows }] });
}

// ── Markdown pipe-table detection (shared grammar with lib/pdf.js) ────────────
// A GitHub-style table:  | a | b |  /  | --- | --- |  /  | 1 | 2 |
const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
const splitTableRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  .map(c => c.replace(/\*\*(.+?)\*\*/g, '$1').trim());

// Convert lightweight markdown-ish prose (the kind the model returns) into Word
// blocks: # / ## / ### headings, "- " bullets, | pipe | tables, and paragraphs.
function buildWordFromText(title, text, subtitle = '') {
  const blocks = [];
  const lines = String(text || '').split(/\r?\n/);
  let bullets = [];
  const flush = () => { if (bullets.length) { blocks.push({ type: 'bullet', items: bullets }); bullets = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\*\*(.+?)\*\*/g, '$1');   // strip bold markers

    // Pipe table: header row immediately followed by a separator row.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const columns = splitTableRow(line);
      i += 2;                                     // consume header + separator
      const rows = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) {
        rows.push(splitTableRow(lines[i])); i++;
      }
      i--;                                        // for-loop re-increments
      blocks.push({ type: 'table', columns, rows });
      continue;
    }

    if (/^###\s+/.test(line))      { flush(); blocks.push({ type: 'heading', level: 3, text: line.replace(/^###\s+/, '') }); }
    else if (/^##\s+/.test(line))  { flush(); blocks.push({ type: 'heading', level: 2, text: line.replace(/^##\s+/, '') }); }
    else if (/^#\s+/.test(line))   { flush(); blocks.push({ type: 'heading', level: 1, text: line.replace(/^#\s+/, '') }); }
    else if (/^\s*[-*•]\s+/.test(line)) { bullets.push(line.replace(/^\s*[-*•]\s+/, '')); }
    else if (line.trim() === '')   { flush(); }
    else                           { flush(); blocks.push({ type: 'para', text: line }); }
  }
  flush();
  return buildWordDoc({ title, subtitle, blocks });
}

module.exports = { buildWordDoc, buildWordTable, buildWordFromText };
