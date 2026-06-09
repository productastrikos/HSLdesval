'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Drawing Data Extraction
// Reads engineering drawings (PDF / scanned PDF / image), understands cable
// tags, equipment tags, legends and engineering symbols, and extracts the
// information the user asks for into a structured table (→ Excel downstream).
//
// Pipeline for multi-page PDFs:
//   1. Legend pass   — read the whole drawing once: title block + cable legend
//                      + equipment legend + general notes.
//   2. Per-page pass — split the PDF with pdf-lib and read each sheet with the
//                      legend supplied as context, so circled cable-type refs
//                      resolve to real cable size/type. Bounded concurrency.
//   3. Merge         — concatenate rows, drop blanks/SPARE, dedupe by tag,
//                      renumber the serial column.
// Single images and un-splittable PDFs use a single whole-document pass.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');

const { getModel, generateJSON, generateJSONFromParts } = require('../lib/llm');
const { mapLimit } = require('./_util');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const CONCURRENCY = parseInt(process.env.DRAWING_CONCURRENCY || '3', 10);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']);

const SYSTEM = `You are a senior marine/electrical draughtsman and design engineer at a shipyard.
You read engineering drawings precisely: single-line diagrams (SLD), schematics, GA drawings, P&IDs and cable block diagrams.
You understand cable tags, equipment tags, junction-box references, deck/frame location notation (e.g. DK-05, FR.33-47), circled cable-type reference numbers that map to a "recommended cables" legend, equipment legends, and engineering symbols.
You never invent data. You only report what is actually drawn/labelled. If a value is not shown, you output an empty string for that field.`;

function normaliseColumns(raw) {
  if (Array.isArray(raw)) return uniquify(raw.map(c => String(c).trim()).filter(Boolean));
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith('[')) { try { return normaliseColumns(JSON.parse(t)); } catch (_) { /* fall through */ } }
    return uniquify(t.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean));
  }
  return [];
}

// Make column labels unique (JSON row keys must not collide, e.g. two "Location"s)
function uniquify(cols) {
  const seen = {};
  return cols.map(c => {
    if (seen[c] == null) { seen[c] = 1; return c; }
    seen[c] += 1;
    return `${c} (${seen[c]})`;
  });
}

// ── PDF page splitting (pdf-lib, pure JS — no native deps) ───────────────────
async function splitPdfPages(buffer) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const count = src.getPageCount();
  const pages = [];
  for (let i = 0; i < count; i++) {
    const sub = await PDFDocument.create();
    const [p] = await sub.copyPages(src, [i]);
    sub.addPage(p);
    const bytes = await sub.save();
    pages.push(Buffer.from(bytes).toString('base64'));
  }
  return pages;
}

function inlinePdf(base64) { return { inlineData: { mimeType: 'application/pdf', data: base64 } }; }
function inlineImg(base64, mime) { return { inlineData: { mimeType: IMAGE_MIMES.has(mime) ? mime : 'image/jpeg', data: base64 } }; }

// ── Legend / title-block pass ────────────────────────────────────────────────
async function readLegend(part) {
  const prompt = `Study this engineering drawing and extract its reference information.
Return JSON exactly in this shape:
{
  "titleBlock": { "drawingNo": "", "shipNo": "", "sheetNo": "", "title": "", "system": "", "shipyard": "" },
  "cableLegend": [ { "ref": "", "type": "", "size": "", "description": "" } ],
  "equipmentLegend": [ { "ref": "", "symbol": "", "description": "", "qty": "" } ],
  "notes": [ "" ]
}
- "cableLegend": the "recommended cables" / cable schedule legend. "ref" is the circled number or code used on the diagram (e.g. "1", "2", "3"). Put the cable construction in "type" (e.g. "CAT6 shielded ethernet") and the cross-section/spec in "size" (e.g. "2x2x0.75 sqmm").
- "equipmentLegend": the equipment/symbol legend table (Eqpt No, symbol meaning, description incl. part number, quantity).
- Use empty strings/arrays when something is absent. Output ONLY the JSON.`;
  try {
    return await generateJSONFromParts([part, { text: prompt }], { system: SYSTEM, maxOutputTokens: 8192, temperature: 0 });
  } catch (_) {
    return { titleBlock: {}, cableLegend: [], equipmentLegend: [], notes: [] };
  }
}

function legendContext(legend) {
  if (!legend) return '';
  const cables = (legend.cableLegend || []).map(c => `  ref ${c.ref}: ${[c.type, c.size, c.description].filter(Boolean).join(' — ')}`).join('\n');
  const eqpt   = (legend.equipmentLegend || []).map(e => `  ${e.ref || e.symbol}: ${[e.description, e.qty].filter(Boolean).join(' · ')}`).join('\n');
  const notes  = (legend.notes || []).filter(Boolean).map(n => `  - ${n}`).join('\n');
  let s = '';
  if (cables) s += `\nCABLE TYPE LEGEND (a circled number next to a cable on the diagram refers to one of these — resolve cable Type and Size from it):\n${cables}\n`;
  if (eqpt)   s += `\nEQUIPMENT LEGEND:\n${eqpt}\n`;
  if (notes)  s += `\nGENERAL NOTES:\n${notes}\n`;
  return s;
}

// ── Per-page / whole-document extraction pass ────────────────────────────────
async function extractRows(part, { columns, instruction, legend, pageInfo }) {
  const colSpec = columns.length
    ? `Extract the data into a table with EXACTLY these columns (use these exact keys):\n${columns.map(c => `  - "${c}"`).join('\n')}`
    : `Decide the most appropriate columns for the requested table yourself.`;

  const prompt = `${instruction || 'Extract the tabular engineering data from this drawing.'}

${colSpec}
${legendContext(legend)}
INTERPRETATION RULES:
- Read every cable tag / equipment tag / device label visible ${pageInfo ? `on THIS sheet (${pageInfo})` : 'in this drawing'}.
- A circled number drawn on a cable run is its cable-type reference — map it to the cable legend to fill cable Type / Size columns.
- "From Equipment"/"To Equipment" come from the blocks the cable connects (junction box, amplifier feeder, rack, switch, speaker, MDB, UPS, etc.). Include the device's compartment/deck/frame as its Location (e.g. "Wheel House, DK-06, FR.43(P)").
- Treat feeder/junction-box headers (e.g. "J.B-1 SRE COMPT. DK-05", "ZONE-1 AMP-1 FEEDER-2") as the From side for the cables drawn from them.
- Skip runs explicitly marked "SPARE" and skip pure coordinate/location tables that carry no connectivity.
- Never fabricate tags or values that are not shown. Use "" for anything not legible.
${columns.length ? `\nReturn JSON: { "rows": [ { ${columns.map(c => `"${c}": ""`).join(', ')} } ] }` : `\nReturn JSON: { "columns": ["..."], "rows": [ { } ] }`}
Output ONLY the JSON.`;

  const out = await generateJSONFromParts([part, { text: prompt }], { system: SYSTEM, maxOutputTokens: 32768, temperature: 0 });
  return out;
}

// ── Row hygiene: dedupe + renumber ───────────────────────────────────────────
function findCol(columns, ...needles) {
  return columns.find(c => needles.some(n => c.toLowerCase().replace(/[^a-z]/g, '').includes(n)));
}

function cleanRows(columns, rows) {
  const tagCol = findCol(columns, 'cabletag', 'tag', 'cableno', 'cablenumber');
  const slCol  = findCol(columns, 'slno', 'sno', 'serial', 'srno');

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    // drop fully-empty rows
    const hasData = columns.some(c => String(r[c] ?? '').trim() && !/^sl\.?no$/i.test(c));
    if (!hasData) continue;
    // drop SPARE rows
    if (columns.some(c => /^\s*spare\s*$/i.test(String(r[c] ?? '')))) continue;

    const key = tagCol ? String(r[tagCol] ?? '').trim().toUpperCase() : JSON.stringify(columns.map(c => r[c]));
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(r);
  }

  if (slCol) out.forEach((r, i) => { r[slCol] = String(i + 1); });
  return out;
}

// ── POST /api/drawings/extract ───────────────────────────────────────────────
router.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No drawing uploaded.' });

    const columns     = normaliseColumns(req.body.columns);
    const instruction = req.body.prompt || req.body.instruction || '';
    const mime        = req.file.mimetype;
    const isPDF       = mime === 'application/pdf' || /\.pdf$/i.test(req.file.originalname);
    const isImg       = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(req.file.originalname);

    if (!isPDF && !isImg) {
      return res.status(415).json({ error: 'Drawing extraction supports PDF and image files (PNG/JPG/etc.).' });
    }

    let legend = null;
    let allRows = [];
    let proposedColumns = columns;
    let pagesProcessed = 0;
    const perPage = [];

    if (isPDF) {
      let pages = null;
      try { pages = await splitPdfPages(req.file.buffer); } catch (_) { pages = null; }

      if (pages && pages.length > 1) {
        // 1) Legend pass on the whole document (first ~6 pages carry the legends)
        const wholeDoc = inlinePdf(req.file.buffer.toString('base64'));
        legend = await readLegend(wholeDoc);

        // 2) Per-page extraction with bounded concurrency
        const results = await mapLimit(pages, CONCURRENCY, async (b64, idx) => {
          try {
            const out = await extractRows(inlinePdf(b64), {
              columns: proposedColumns, instruction, legend, pageInfo: `sheet ${idx + 1} of ${pages.length}`,
            });
            if (!proposedColumns.length && Array.isArray(out.columns) && out.columns.length) {
              proposedColumns = normaliseColumns(out.columns);
            }
            return Array.isArray(out.rows) ? out.rows : [];
          } catch (e) {
            return { __error: e.message };
          }
        });

        results.forEach((r, idx) => {
          const rows = Array.isArray(r) ? r : [];
          perPage.push({ page: idx + 1, rows: rows.length, error: r && r.__error ? r.__error : null });
          if (Array.isArray(r)) allRows.push(...r);
        });
        pagesProcessed = pages.length;
      } else {
        // single-page PDF (or split failed) — one whole-document pass
        const part = inlinePdf(req.file.buffer.toString('base64'));
        legend = await readLegend(part);
        const out = await extractRows(part, { columns: proposedColumns, instruction, legend });
        if (!proposedColumns.length && Array.isArray(out.columns)) proposedColumns = normaliseColumns(out.columns);
        allRows = Array.isArray(out.rows) ? out.rows : [];
        pagesProcessed = 1;
      }
    } else {
      // image drawing
      const part = inlineImg(req.file.buffer.toString('base64'), mime);
      legend = await readLegend(part);
      const out = await extractRows(part, { columns: proposedColumns, instruction, legend });
      if (!proposedColumns.length && Array.isArray(out.columns)) proposedColumns = normaliseColumns(out.columns);
      allRows = Array.isArray(out.rows) ? out.rows : [];
      pagesProcessed = 1;
    }

    if (!proposedColumns.length) {
      // last-resort columns from first row keys
      proposedColumns = allRows.length ? Object.keys(allRows[0]) : [];
    }

    const rows = cleanRows(proposedColumns, allRows);

    // If every sheet failed (e.g. AI quota/billing) and nothing came back, surface it.
    const pageErrors = perPage.filter(p => p.error).map(p => p.error);
    if (!rows.length && perPage.length && pageErrors.length === perPage.length) {
      return res.status(502).json({ error: `AI drawing extraction failed: ${pageErrors[0]}` });
    }

    res.json({
      columns: proposedColumns,
      rows,
      rowCount: rows.length,
      legend,
      meta: {
        fileName: req.file.originalname,
        pagesProcessed,
        perPage,
        titleBlock: legend?.titleBlock || {},
      },
    });
  } catch (err) {
    console.error('[/api/drawings/extract]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
