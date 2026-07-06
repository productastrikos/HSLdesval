'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Drawing Intelligence  (formerly Drawing Data Extraction)
// Reads engineering drawings (PDF / scanned PDF / image / AutoCAD .dwg/.dxf),
// understands cable tags, equipment tags, legends and symbols, and:
//   • POST /extract   → extracts the data you ask for into a table (cable schedule,
//                       BOM, GA ship specifications, compartment areas, …) → Excel
//   • POST /validate  → validates the drawing against IRS (class) rules → findings
//
// Sources: an uploaded file, OR a pre-loaded library drawing (libraryId).
// AutoCAD: .dxf is parsed structurally (text labels + compartment areas via the
// shoelace formula); binary .dwg recovers version + embedded labels (best effort).
// PDFs/images use the multi-page legend-aware vision pipeline.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');

const { getModel, generateJSON, generateJSONFromParts, generateText } = require('../lib/llm');
const { mapLimit, ragContextBlock } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
const { parseCad, isCadName } = require('../lib/cad');
const { resolveLibraryFile } = require('./library');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const CONCURRENCY = parseInt(process.env.DRAWING_CONCURRENCY || '3', 10);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']);

const SYSTEM = `You are a senior marine/electrical draughtsman and design engineer at a shipyard.
You read engineering drawings precisely: single-line diagrams (SLD), schematics, General Arrangement (GA) plans, P&IDs and cable block diagrams.
You understand cable tags, equipment tags, junction-box references, deck/frame location notation (e.g. DK-05, FR.33-47), circled cable-type reference numbers that map to a "recommended cables" legend, equipment legends, compartment labels, principal dimensions and engineering symbols.
You never invent data. You only report what is actually drawn/labelled. If a value is not shown, you output an empty string for that field.`;

// ── Source acquisition: uploaded file OR pre-loaded library drawing ───────────
function getSource(req) {
  if (req.file) return { buffer: req.file.buffer, mime: req.file.mimetype, name: req.file.originalname };
  const libId = req.body.libraryId || req.body.libraryFile;
  if (libId) {
    const lib = resolveLibraryFile(libId);
    if (!lib) { const e = new Error('Selected library drawing was not found on the server.'); e.status = 404; throw e; }
    return { buffer: fs.readFileSync(lib.path), mime: lib.mime, name: lib.name };
  }
  const e = new Error('No drawing provided. Upload a drawing or select a pre-loaded one.'); e.status = 400; throw e;
}

function normaliseColumns(raw) {
  if (Array.isArray(raw)) return uniquify(raw.map(c => String(c).trim()).filter(Boolean));
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith('[')) { try { return normaliseColumns(JSON.parse(t)); } catch (_) {} }
    return uniquify(t.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean));
  }
  return [];
}
function uniquify(cols) {
  const seen = {};
  return cols.map(c => { if (seen[c] == null) { seen[c] = 1; return c; } seen[c] += 1; return `${c} (${seen[c]})`; });
}

// ── PDF page splitting (pdf-lib) ──────────────────────────────────────────────
async function splitPdfPages(buffer) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const count = src.getPageCount();
  const pages = [];
  for (let i = 0; i < count; i++) {
    const sub = await PDFDocument.create();
    const [p] = await sub.copyPages(src, [i]);
    sub.addPage(p);
    pages.push(Buffer.from(await sub.save()).toString('base64'));
  }
  return pages;
}

function inlinePdf(base64) { return { inlineData: { mimeType: 'application/pdf', data: base64 } }; }
function inlineImg(base64, mime) { return { inlineData: { mimeType: IMAGE_MIMES.has(mime) ? mime : 'image/jpeg', data: base64 } }; }

async function readLegend(part) {
  const prompt = `Study this engineering drawing and extract its reference information.
Return JSON exactly in this shape:
{
  "titleBlock": { "drawingNo": "", "shipNo": "", "sheetNo": "", "title": "", "system": "", "shipyard": "" },
  "cableLegend": [ { "ref": "", "type": "", "size": "", "description": "" } ],
  "equipmentLegend": [ { "ref": "", "symbol": "", "description": "", "qty": "" } ],
  "notes": [ "" ]
}
- "cableLegend": the "recommended cables" / cable schedule legend. "ref" is the circled number/code used on the diagram. Put cable construction in "type" and the cross-section/spec in "size".
- "equipmentLegend": the equipment/symbol legend (Eqpt No, symbol meaning, description incl. part number, quantity).
- Use empty strings/arrays when absent. Output ONLY the JSON.`;
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
  if (cables) s += `\nCABLE TYPE LEGEND (a circled number next to a cable refers to one of these — resolve cable Type and Size):\n${cables}\n`;
  if (eqpt)   s += `\nEQUIPMENT LEGEND:\n${eqpt}\n`;
  if (notes)  s += `\nGENERAL NOTES:\n${notes}\n`;
  return s;
}

function colSpecText(columns) {
  return columns.length
    ? `Extract the data into a table with EXACTLY these columns (use these exact keys):\n${columns.map(c => `  - "${c}"`).join('\n')}`
    : `Decide the most appropriate columns for the requested table yourself.`;
}

async function extractRows(part, { columns, instruction, legend, pageInfo }) {
  const prompt = `${instruction || 'Extract the tabular engineering data from this drawing.'}

${colSpecText(columns)}
${legendContext(legend)}
INTERPRETATION RULES:
- Read everything including cable tag / equipment tag / device label / compartment label visible ${pageInfo ? `on THIS sheet (${pageInfo})` : 'in this drawing'}.
- A circled number drawn on a cable run is its cable-type reference — map it to the cable legend to fill cable Type / Size columns.
- For GA plans, read everything including principal dimensions, compartment names and any stated areas; for BOM requests, use the equipment legend and tags.
- Skip runs explicitly marked "SPARE". Never fabricate tags or values that are not shown — use "" for anything not legible.
${columns.length ? `\nReturn JSON: { "rows": [ { ${columns.map(c => `"${c}": ""`).join(', ')} } ] }` : `\nReturn JSON: { "columns": ["..."], "rows": [ { } ] }`}
Output ONLY the JSON.`;
  return generateJSONFromParts([part, { text: prompt }], { system: SYSTEM + getFeedbackGuidance('drawings'), maxOutputTokens: 32768, temperature: 0 });
}

// ── Text-based extraction for CAD (the cad summary is plain text) ─────────────
async function extractRowsFromText(summary, { columns, instruction }) {
  const prompt = `${instruction || 'Extract the tabular engineering data from this CAD drawing.'}

The following is structured data parsed from an AutoCAD drawing (text labels and, for DXF, computed compartment areas):

${summary.slice(0, 30000)}

${colSpecText(columns)}
- For GA plans, list compartments with their computed areas; for BOM/equipment requests, list equipment/material items from the labels.
- Never fabricate values — use "" when not present.
${columns.length ? `\nReturn JSON: { "rows": [ { ${columns.map(c => `"${c}": ""`).join(', ')} } ] }` : `\nReturn JSON: { "columns": ["..."], "rows": [ { } ] }`}
Output ONLY the JSON.`;
  return generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('drawings'), maxOutputTokens: 16000, temperature: 0 });
}

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
    const hasData = columns.some(c => String(r[c] ?? '').trim() && !/^sl\.?no$/i.test(c));
    if (!hasData) continue;
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
    const src = getSource(req);
    const columns     = normaliseColumns(req.body.columns);
    const instruction = req.body.prompt || req.body.instruction || '';
    const { buffer, mime, name } = src;
    const isPDF = mime === 'application/pdf' || /\.pdf$/i.test(name);
    const isImg = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name);
    const isCad = isCadName(name, mime);

    if (!isPDF && !isImg && !isCad) {
      return res.status(415).json({ error: 'Drawing Intelligence supports PDF, image (PNG/JPG/…) and AutoCAD (.dwg/.dxf) files.' });
    }

    let legend = null, allRows = [], proposedColumns = columns, pagesProcessed = 0, cad = null;
    const perPage = [];

    if (isCad) {
      cad = await parseCad(buffer, name);
      const out = await extractRowsFromText(cad.summary, { columns: proposedColumns, instruction });
      if (!proposedColumns.length && Array.isArray(out.columns)) proposedColumns = normaliseColumns(out.columns);
      allRows = Array.isArray(out.rows) ? out.rows : [];
      pagesProcessed = 1;
      legend = { titleBlock: { drawingNo: '', title: name, system: '' }, cableLegend: [], equipmentLegend: [], notes: cad.note ? [cad.note] : [] };
    } else if (isPDF) {
      let pages = null;
      try { pages = await splitPdfPages(buffer); } catch (_) { pages = null; }
      if (pages && pages.length > 1) {
        legend = await readLegend(inlinePdf(buffer.toString('base64')));
        const results = await mapLimit(pages, CONCURRENCY, async (b64, idx) => {
          try {
            const out = await extractRows(inlinePdf(b64), { columns: proposedColumns, instruction, legend, pageInfo: `sheet ${idx + 1} of ${pages.length}` });
            if (!proposedColumns.length && Array.isArray(out.columns) && out.columns.length) proposedColumns = normaliseColumns(out.columns);
            return Array.isArray(out.rows) ? out.rows : [];
          } catch (e) { return { __error: e.message }; }
        });
        results.forEach((r, idx) => {
          const rows = Array.isArray(r) ? r : [];
          perPage.push({ page: idx + 1, rows: rows.length, error: r && r.__error ? r.__error : null });
          if (Array.isArray(r)) allRows.push(...r);
        });
        pagesProcessed = pages.length;
      } else {
        const part = inlinePdf(buffer.toString('base64'));
        legend = await readLegend(part);
        const out = await extractRows(part, { columns: proposedColumns, instruction, legend });
        if (!proposedColumns.length && Array.isArray(out.columns)) proposedColumns = normaliseColumns(out.columns);
        allRows = Array.isArray(out.rows) ? out.rows : [];
        pagesProcessed = 1;
      }
    } else {
      const part = inlineImg(buffer.toString('base64'), mime);
      legend = await readLegend(part);
      const out = await extractRows(part, { columns: proposedColumns, instruction, legend });
      if (!proposedColumns.length && Array.isArray(out.columns)) proposedColumns = normaliseColumns(out.columns);
      allRows = Array.isArray(out.rows) ? out.rows : [];
      pagesProcessed = 1;
    }

    if (!proposedColumns.length) proposedColumns = allRows.length ? Object.keys(allRows[0]) : [];
    const rows = cleanRows(proposedColumns, allRows);

    const pageErrors = perPage.filter(p => p.error).map(p => p.error);
    if (!rows.length && perPage.length && pageErrors.length === perPage.length) {
      return res.status(502).json({ error: `AI drawing extraction failed: ${pageErrors[0]}` });
    }

    res.json({
      columns: proposedColumns, rows, rowCount: rows.length, legend,
      cad: cad ? { kind: cad.kind, version: cad.version, units: cad.units, regions: cad.regions, note: cad.note } : null,
      meta: { fileName: name, pagesProcessed, perPage, titleBlock: legend?.titleBlock || {} },
    });
  } catch (err) {
    console.error('[/api/drawings/extract]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── Vision description for rule validation ────────────────────────────────────
async function describeDrawing(buffer, mime, name) {
  const isPDF = mime === 'application/pdf' || /\.pdf$/i.test(name);
  if (isCadName(name, mime)) return (await parseCad(buffer, name)).summary;
  const part = isPDF ? inlinePdf(buffer.toString('base64')) : inlineImg(buffer.toString('base64'), mime);
  const prompt = `Describe this engineering drawing in detail for a class-rule compliance review. List: drawing title/number/system; all equipment and their ratings; cable types, sizes and segregation; protective devices and discrimination; earthing/bonding; power sources and emergency supplies; redundancy; and anything safety-relevant. Be thorough and factual.`;
  try {
    const r = await getModel(SYSTEM).generateContent([part, { text: prompt }], { maxOutputTokens: 4096, temperature: 0 });
    return r.response.text();
  } catch (e) { return ''; }
}

// ── POST /api/drawings/validate  (against IRS / class rules) ──────────────────
router.post('/validate', upload.single('file'), async (req, res) => {
  try {
    const src = getSource(req);
    const focus = req.body.prompt || req.body.focus || '';
    const description = await describeDrawing(src.buffer, src.mime, src.name);
    if (!description || !description.trim()) {
      return res.status(422).json({ error: 'Could not read the drawing for validation. Try a clearer PDF/image or a DXF export.' });
    }

    const { block: ruleBlock, citations } = await ragContextBlock(
      `IRS Indian Register of Shipping rules ${focus} ${description.slice(0, 400)}`, 10);

    // Additional validation sources (HSL MVP item 10): Build Specification, Binding
    // data of the corresponding equipment/system, and relevant Lessons Learnt.
    const buildSpecText = String(req.body.buildSpecText || '').slice(0, 9000);
    const bindingText   = String(req.body.bindingText || '').slice(0, 9000);
    const lessonsBlock  = require('./lessons').getLessonsGuidance(`${focus} ${description.slice(0, 300)}`, 8);

    const prompt = `Validate the following ship engineering drawing against the applicable sources${focus ? ` with focus on: ${focus}` : ''}: IRS (Indian Register of Shipping) classification rules, the Build Specification, the Binding data of the corresponding equipment/system, and historical Lessons Learnt.

DRAWING CONTENT (read from the drawing):
${description.slice(0, 12000)}

APPLICABLE IRS / CLASS RULES (from the knowledge base):
${ruleBlock || '(none retrieved — use established IRS rule knowledge)'}
${buildSpecText ? `\nBUILD SPECIFICATION (validate the drawing against these requirements):\n${buildSpecText}\n` : ''}${bindingText ? `\nBINDING DATA / EQUIPMENT DATA (cross-check dimensions, ratings, interfaces against the drawing):\n${bindingText}\n` : ''}${lessonsBlock || ''}

Return ONLY JSON: { "findings": [ {
  "area":        "",  // review area (e.g. "Cable segregation", "Earthing", "Short-circuit protection")
  "source":      "",  // which source this finding is against: "IRS Rule" | "Build Specification" | "Binding Data" | "Lessons Learnt"
  "irsReference":"",  // IRS clause / Part-Chapter-Section, build-spec clause, or applicable rule id
  "requirement": "",  // what the rule/spec/binding-data requires
  "observation": "",  // what the drawing shows vs the requirement
  "status":      "Compliant" | "Non-Compliant" | "Requires Review",
  "severity":    "critical" | "high" | "medium" | "low",
  "recommendation":""
} ] }
Produce 8-20 findings across multiple areas and across ALL the provided sources. Reference specific clauses where possible.`;
    const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('drawings'), temperature: 0.2, maxOutputTokens: 16000 });
    const findings = (Array.isArray(out.findings) ? out.findings : []).map((f, i) => ({ slNo: i + 1, ...f }));
    const statuses = ['Compliant', 'Non-Compliant', 'Requires Review'];
    const stats = {}; for (const s of statuses) stats[s] = findings.filter(f => f.status === s).length;

    res.json({ drawing: src.name, focus, total: findings.length, stats, statuses, findings, citations });
  } catch (err) {
    console.error('[/api/drawings/validate]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/drawings/compare  (two drawings → prompt-driven differences) ────
const compareUpload = upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]);
router.post('/compare', compareUpload, async (req, res) => {
  try {
    const resolve = (field, libId, label) => {
      const f = req.files && req.files[field] && req.files[field][0];
      if (f) return { buffer: f.buffer, mime: f.mimetype, name: f.originalname };
      if (libId) {
        const lib = resolveLibraryFile(libId);
        if (!lib) { const e = new Error(`Selected ${label} was not found on the server.`); e.status = 404; throw e; }
        return { buffer: fs.readFileSync(lib.path), mime: lib.mime, name: lib.name };
      }
      const e = new Error(`Provide ${label} (upload a file or pick a pre-loaded drawing).`); e.status = 400; throw e;
    };
    const a = resolve('fileA', req.body.libraryIdA, 'Drawing A');
    const b = resolve('fileB', req.body.libraryIdB, 'Drawing B');
    const prompt = req.body.prompt || '';

    const [da, db] = await Promise.all([
      describeDrawing(a.buffer, a.mime, a.name),
      describeDrawing(b.buffer, b.mime, b.name),
    ]);
    if (!da.trim() || !db.trim()) {
      return res.status(422).json({ error: 'Could not read one of the drawings. Try clearer files or DXF exports.' });
    }

    const colA = `Drawing A · ${a.name}`;
    const colB = `Drawing B · ${b.name}`;
    const full = `Compare these two engineering drawings${prompt ? `, focusing on: ${prompt}` : ''}. Identify every meaningful difference.

DRAWING A — ${a.name}:
${da.slice(0, 9000)}

DRAWING B — ${b.name}:
${db.slice(0, 9000)}

Return ONLY JSON: { "rows": [ { "Aspect":"", "Drawing A":"", "Drawing B":"", "Difference":"", "Severity":"critical|high|medium|low", "Remark":"" } ] }
Produce 6-20 rows covering equipment, ratings, cabling, connections, layout and annotations.`;
    const out = await generateJSON(full, { system: SYSTEM + getFeedbackGuidance('drawings'), temperature: 0.2, maxOutputTokens: 12000 });
    const columns = ['Aspect', colA, colB, 'Difference', 'Severity', 'Remark'];
    const rows = (Array.isArray(out.rows) ? out.rows : []).map(r => ({
      'Aspect': r['Aspect'] || r.aspect || '',
      [colA]:   r['Drawing A'] || r.a || '',
      [colB]:   r['Drawing B'] || r.b || '',
      'Difference': r['Difference'] || r.difference || '',
      'Severity':   r['Severity'] || r.severity || '',
      'Remark':     r['Remark'] || r.remark || '',
    }));
    res.json({ drawingA: a.name, drawingB: b.name, columns, rows, rowCount: rows.length });
  } catch (err) {
    console.error('[/api/drawings/compare]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
