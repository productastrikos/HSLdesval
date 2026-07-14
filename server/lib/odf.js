'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// OpenDocument Format (ODF) builder — produces REAL, standards-valid files that
// open in LibreOffice / OpenOffice / MS Office, not plain text with a renamed
// extension.
//
//   buildOds(sheets)               → Promise<Buffer>  OpenDocument Spreadsheet (.ods)
//   buildOdt(title, text, subtitle)→ Promise<Buffer>  OpenDocument Text (.odt)
//
// An ODF file is a ZIP containing, at minimum: an uncompressed `mimetype` entry
// (first), META-INF/manifest.xml, and content.xml. We build it with JSZip.
//
// `sheets` uses the same portable spec as lib/excel.js:
//   [{ name, columns:[label], rows:[obj|array], title?, meta? }]
// ─────────────────────────────────────────────────────────────────────────────

const JSZip = require('jszip');

const MIME_ODS = 'application/vnd.oasis.opendocument.spreadsheet';
const MIME_ODT = 'application/vnd.oasis.opendocument.text';

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
].join(' ');

function xmlEscape(v) {
  const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cellXml(v) {
  return `<table:table-cell office:value-type="string"><text:p>${xmlEscape(v)}</text:p></table:table-cell>`;
}

function rowXml(values) {
  return `<table:table-row>${values.map(cellXml).join('')}</table:table-row>`;
}

function manifestXml(mime) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
}

// The mimetype entry MUST be first and STOREd (uncompressed) per the ODF spec.
async function packageOdf(mime, contentXml) {
  const zip = new JSZip();
  zip.file('mimetype', mime, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifestXml(mime));
  zip.file('content.xml', contentXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: mime });
}

function sheetXml(spec, idx) {
  const { columns = [], rows = [], title, meta } = spec;
  const name = (spec.name || `Sheet${idx + 1}`).replace(/[^\w .-]/g, ' ').slice(0, 63) || `Sheet${idx + 1}`;
  const out = [`<table:table table:name="${xmlEscape(name)}">`];

  if (title) out.push(rowXml([title]));
  if (Array.isArray(meta)) for (const m of meta) out.push(rowXml(Array.isArray(m) ? m : [m]));
  if (columns.length) out.push(rowXml(columns));

  for (const row of rows) {
    const vals = Array.isArray(row) ? columns.map((_, i) => row[i]) : columns.map(c => row[c]);
    out.push(rowXml(vals));
  }
  out.push('</table:table>');
  return out.join('');
}

async function buildOds(sheets) {
  const list = (Array.isArray(sheets) && sheets.length) ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }];
  const body = list.map(sheetXml).join('');
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2">
  <office:body><office:spreadsheet>${body}</office:spreadsheet></office:body>
</office:document-content>`;
  return packageOdf(MIME_ODS, contentXml);
}

async function buildOdt(title, text, subtitle) {
  const paras = String(text || '').split(/\r?\n/);
  const blocks = [];
  if (title)    blocks.push(`<text:h text:outline-level="1">${xmlEscape(title)}</text:h>`);
  if (subtitle) blocks.push(`<text:p>${xmlEscape(subtitle)}</text:p>`);
  for (const p of paras) blocks.push(`<text:p>${xmlEscape(p)}</text:p>`);

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2">
  <office:body><office:text>${blocks.join('')}</office:text></office:body>
</office:document-content>`;
  return packageOdf(MIME_ODT, contentXml);
}

module.exports = { buildOds, buildOdt, MIME_ODS, MIME_ODT };
