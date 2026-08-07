'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// BOM Generation & SOTR Generation
//   - POST /api/bom/generate  { sources:[{name,text}], prompt, columns[] }
//        Generate a Bill of Materials from the RFP + Build Specification (+ GA),
//        with Equipment Name, OEM, Capacity, Page Number, Reference and AI
//        estimation/calculation (e.g. number of speakers from compartment area).
//   - POST /api/bom/sotr      { sources:[{name,text}] | bom:[...], columns, prompt, title }
//        Generate a Statement of Technical Requirements (SOTR). Two independent
//        sources of truth: directly from the build-specification documents
//        (map-reduce over the spec), or derived from an approved BOM. Guided by
//        the user's prompt → returns a Markdown document (→ Word/PDF/TXT).
//
// BOM and SOTR are independent modules: the user can produce either one straight
// from the build specs, in any order.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');
const { generateJSON, generateText } = require('../lib/llm');
const { mapLimit, ragContextBlock } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');
const { parseElaWorkbook, summarizeLoads } = require('../lib/ela');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const DEFAULT_COLUMNS = ['Equipment Name', 'OEM', 'Capacity', 'Quantity', 'Page Number', 'Reference'];

const BOM_SYS = `You are a senior shipbuilding estimation engineer preparing a Bill of Materials (BOM) from tender and build-specification documents.
You identify every distinct equipment / system / material item the vessel requires, with its maker/OEM (if named), capacity/rating, and the page + clause it is referenced from.
You can ESTIMATE quantities by calculation when asked (e.g. number of PA speakers from a compartment's area/volume, number of light fittings from deck area, cable lengths from runs) — when you estimate, state the basis briefly in the Reference/remarks.
Page markers look like "----- Page 7 -----"; use the nearest preceding marker as the Page Number. Never invent OEM names or values that are not supported — use "" instead.`;

function normaliseColumns(raw) {
  if (Array.isArray(raw)) return raw.map(c => String(c).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    // multipart/form-data fields arrive as plain strings even when the client sent
    // JSON.stringify(columns) (see /ela-size) — try that shape before falling back
    // to a comma-separated list.
    if (t.startsWith('[')) { try { return normaliseColumns(JSON.parse(t)); } catch (_) { /* fall through */ } }
    return t.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// Tolerant column-key matching shared by every route that maps AI-returned rows
// onto a caller-chosen column set: a model may echo a requested column with
// different casing/spacing/punctuation (e.g. "Make / Vendor" vs "Make/Vendor").
// Without this, every value reads as "" and the row is silently dropped.
const normKey = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function pickCol(row, col) {
  if (row[col] != null && row[col] !== '') return row[col];
  const want = normKey(col);
  for (const k of Object.keys(row)) if (normKey(k) === want) return row[k];
  return '';
}

function windows(text, size = 13000) {
  const paras = String(text || '').split(/\n{2,}/);
  const out = []; let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

// Build [{name, chunk}] preserving each source's name on every chunk.
function chunkSources(sources) {
  const out = [];
  for (const s of sources) {
    if (!s || !s.text || !s.text.trim()) continue;
    for (const c of windows(s.text)) out.push({ name: s.name || 'source', chunk: c });
  }
  return out;
}

async function bomForChunk({ name, chunk }, prompt, columns) {
  const full = `Extract Bill-of-Materials items from this section of "${name}".
${prompt ? `User instructions: ${prompt}` : ''}

Use EXACTLY these columns as JSON keys (use "" when not stated):
${columns.map(c => `  - "${c}"`).join('\n')}

SECTION CONTENT:
${chunk}

Return ONLY JSON: { "rows": [ { ${columns.map(c => `"${c}": ""`).join(', ')} } ] }
- One row per distinct equipment/material item. Set "Reference" to the clause/section/spec id (and the source name "${name}"). Set "Page Number" from the nearest "----- Page N -----" marker.
- If the user asked you to estimate a quantity, compute it and note the basis in "Reference".`;
  const out = await generateJSON(full, { system: BOM_SYS + getFeedbackGuidance('bom'), temperature: 0.15, maxOutputTokens: 16000 });
  return Array.isArray(out.rows) ? out.rows : [];
}

// POST /api/bom/generate
router.post('/generate', async (req, res) => {
  try {
    const prompt  = req.body.prompt || '';
    const columns = normaliseColumns(req.body.columns).length ? normaliseColumns(req.body.columns) : DEFAULT_COLUMNS.slice();
    const sources = Array.isArray(req.body.sources) ? req.body.sources.filter(s => s && s.text) : [];
    if (!sources.length) return res.status(400).json({ error: 'Provide at least one source document (RFP / Build Specification).' });

    const chunks = chunkSources(sources);
    const errors = [];
    const parts = await mapLimit(chunks, 2, async (c) => {
      try { return await bomForChunk(c, prompt, columns); }
      catch (e) { errors.push(e.message); return []; }
    });
    let rows = parts.flat().filter(r => r && typeof r === 'object');
    if (!rows.length && errors.length) return res.status(502).json({ error: `AI BOM generation failed: ${errors[0]}` });

    // Normalise to columns + dedupe by equipment name (keep the richer row).
    // Match keys tolerantly: a model may echo a requested column with different
    // casing/spacing/punctuation (e.g. "Make / Vendor" vs "Make/Vendor"). Without
    // this, every value reads as "" and every row is dropped → "No BOM items
    // were generated" even though the model returned data.
    const nameCol = columns.find(c => /equipment|item|material|name/i.test(c)) || columns[0];
    const seen = new Map();
    for (const r of rows) {
      const o = {}; columns.forEach(c => { o[c] = (pickCol(r, c) ?? '').toString().trim(); });
      if (!columns.some(c => o[c])) continue;
      const key = (o[nameCol] || JSON.stringify(o)).toLowerCase();
      const prev = seen.get(key);
      const filled = obj => columns.reduce((n, c) => n + (obj[c] ? 1 : 0), 0);
      if (!prev || filled(o) > filled(prev)) seen.set(key, o);
    }

    // Last-resort salvage: the model returned rows, but none of their keys mapped
    // to the requested columns (severe key-drift on a weaker model). Rather than
    // tell the user "No BOM items were generated", map each row's values onto the
    // requested columns positionally so the extracted data is never lost.
    if (!seen.size && rows.length) {
      console.warn(`[/api/bom/generate] key-drift salvage: ${rows.length} rows had no matching column keys — remapping positionally.`);
      for (const r of rows) {
        const vals = Object.values(r).map(v => (v ?? '').toString().trim());
        if (!vals.some(Boolean)) continue;
        const o = {}; columns.forEach((c, i) => { o[c] = vals[i] || ''; });
        const key = (o[nameCol] || JSON.stringify(o)).toLowerCase();
        if (!seen.has(key)) seen.set(key, o);
      }
    }
    // Order system-wise & discipline-wise (prescribed HSL format) when those
    // columns are present, so the BOM is reliably grouped regardless of LLM order.
    const discCol = columns.find(c => /discipline/i.test(c));
    const sysCol  = columns.find(c => /\bsystem\b/i.test(c));
    const DISC_ORDER = ['electrical', 'machinery', 'hull', 'outfit', 'piping', 'hvac'];
    const discRank = v => { const i = DISC_ORDER.indexOf((v || '').toLowerCase().trim()); return i === -1 ? 99 : i; };
    let ordered = [...seen.values()];
    if (discCol || sysCol) {
      ordered.sort((a, b) => {
        if (discCol) { const d = discRank(a[discCol]) - discRank(b[discCol]); if (d) return d;
          const da = (a[discCol] || '').localeCompare(b[discCol] || ''); if (da) return da; }
        if (sysCol)  return (a[sysCol] || '').localeCompare(b[sysCol] || '');
        return 0;
      });
    }
    rows = ordered.map((r, i) => ({ 'S.No': String(i + 1), ...r }));
    const outColumns = ['S.No', ...columns];

    res.json({ columns: outColumns, rows, rowCount: rows.length, sources: sources.map(s => s.name) });
  } catch (err) {
    console.error('[/api/bom/generate]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Generator & Transformer capacity sizing from an Electrical Load Analysis (ELA)
// workbook — POST /api/bom/ela-size  (multipart: file=.xls/.xlsx, columns=JSON)
//
// The arithmetic (summing consumer loads per switchboard per operating mode,
// finding the worst-case mode, kW→kVA via power factor, margining) is done
// deterministically in server/lib/ela.js — NOT by the model, because correctly
// summing dozens of rows across several switchboard tabs is exactly the kind of
// thing an LLM gets subtly wrong. The model's job here is narrower and better
// suited to it: given the computed numbers, decide a standard catalogue
// capacity, a redundant count, and write a one-line engineering basis — then
// return the recommendation shaped as BOM rows so they merge straight into the
// Bill of Materials.
// ─────────────────────────────────────────────────────────────────────────────

const ELA_SIZING_SYS = `You are a senior marine electrical engineer sizing Diesel Generators and Transformers from an Electrical Load Analysis (ELA) that has already been reduced to worst-case load figures (the arithmetic is done — you are NOT summing consumer loads yourself).
Given the computed worst-case main-bus load (kW/kVA), worst-case emergency-bus load, any per-switchboard transformer minimums, the margin and power factor already applied, and any free-text hints found in the workbook (existing generator inventory lines, an engineer's own sizing notes), recommend:
  - Main generator(s): if a workbook hint already states a decided fleet count (e.g. "04 x Diesel Generator"), STRONGLY prefer that exact count and size EACH unit so the running units (count minus one spare) cover the worst-case load, rounded UP to a standard genset size — do not default to a generic small-unit guess when the yard has already told you the intended fleet size. Otherwise choose quantity and unit capacity (kVA) yourself, rounded UP to a standard industrial genset size (e.g. 62.5, 100, 125, 160, 200, 250, 315, 400, 500, 625, 750, 1000, 1250, 1500, 2000, 2500, 3000, 3750 kVA), defaulting to N+1 redundancy (one more running set than strictly needed). Whichever path, the quantity minus one spare, multiplied by the unit capacity, MUST be at least the worst-case kVA figure — check this multiplication before answering. State whichever assumption you used.
  - Emergency generator: capacity to cover the worst-case emergency-bus load alone (it must run independently of the main bus), rounded to a standard size.
  - Harbour generator, if the workbook's own hints mention one as a separate unit.
  - Transformer(s): one recommendation per switchboard listed under "transformers" below, sized to at least its minKva, rounded to a standard transformer size (e.g. 25, 50, 63, 100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600 kVA).
Do NOT invent or alter any load figure — use exactly the numbers given. Every row's basis must cite the specific number(s) it is sized from and the rounding/redundancy rule applied. If a caveat note flags mixed vessels or double-counting risk, still produce a best-effort recommendation but mention the caveat in that row's basis.`;

// Guard against the model's arithmetic slipping (e.g. proposing 5 x 1000 kVA
// generators = 5000 kVA total against a 9911 kVA worst-case load — a real
// failure observed in testing): re-derive quantity×capacity deterministically
// and correct it in code rather than trust the model's multiplication. The
// STANDARD capacity size is left as the model's judgment call; only the count
// is corrected, and only up to a sane fleet size — beyond that the chosen unit
// size itself is too small, so the row is flagged for manual review instead of
// silently proposing an implausible generator count.
const MAX_SANE_UNIT_COUNT = 12;
function findCol(columns, re) { return columns.find(c => re.test(c)); }
function parseNum(v) { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; }

function validateAndCorrectSizing(mapped, columns, summary) {
  const capCol = findCol(columns, /capacity/i);
  const qtyCol = findCol(columns, /quantity|qty/i);
  const nameCol = findCol(columns, /equipment|item|material|^name$/i) || columns[0];
  const refCol = findCol(columns, /reference|remarks|basis/i);
  if (!capCol || !qtyCol) return mapped;   // caller's column set doesn't carry capacity/quantity — nothing to check

  return mapped.map(row => {
    const name = String(row[nameCol] || '');
    const capacity = parseNum(row[capCol]);
    const qty = Math.max(1, Math.round(parseNum(row[qtyCol])) || 1);
    if (!capacity) return row;

    let target = null;
    if (/transformer/i.test(name)) {
      const match = summary.transformers.find(t => name.toLowerCase().includes(t.sheet.toLowerCase()) || t.sheet.toLowerCase().includes(name.toLowerCase().replace(/transformer/i, '').trim()));
      target = match ? match.minKva : null;
    } else if (/emergency/i.test(name) && /generator/i.test(name)) {
      target = summary.emergencyWorstCase.loadKva;
    } else if (/generator/i.test(name) && !/harbour/i.test(name)) {
      target = summary.mainWorstCase.loadKva;
    }
    if (target == null || target <= 0) return row;

    const covered = qty * capacity;
    if (covered >= target * 0.999) return row;   // AI's figures already cover the computed load

    const neededQty = Math.ceil(target / capacity);
    const out = { ...row };
    if (neededQty <= MAX_SANE_UNIT_COUNT) {
      out[qtyCol] = String(neededQty);
      if (refCol) out[refCol] = `${row[refCol] || ''} [quantity auto-corrected from ${qty} to ${neededQty} — ${qty}×${capacity} kVA did not cover the computed ${Math.round(target)} kVA requirement]`.trim();
    } else if (refCol) {
      out[refCol] = `⚠ Needs manual review: ${capacity} kVA is too small a unit for the computed ${Math.round(target)} kVA requirement (would need ${neededQty} units). ${row[refCol] || ''}`.trim();
    }
    return out;
  });
}

async function recommendGeneratorsAndTransformers(summary, parsed, columns) {
  const full = `Recommend generator and transformer capacities from this pre-computed Electrical Load Analysis summary.

WORST-CASE MAIN-BUS LOAD (drives Main Generator sizing):
  Mode: ${summary.mainWorstCase.modeName}
  Load: ${summary.mainWorstCase.loadKw} kW measured; ${summary.mainWorstCase.loadKwWithMargin} kW with ${summary.marginPct}% margin; ${summary.mainWorstCase.loadKva} kVA at power factor ${summary.powerFactor}

WORST-CASE EMERGENCY-BUS LOAD (drives Emergency Generator sizing):
  Mode: ${summary.emergencyWorstCase.modeName}
  Load: ${summary.emergencyWorstCase.loadKw} kW measured; ${summary.emergencyWorstCase.loadKwWithMargin} kW with ${summary.marginPct}% margin; ${summary.emergencyWorstCase.loadKva} kVA at power factor ${summary.powerFactor}

TRANSFORMER MINIMUMS (one recommendation per entry):
${summary.transformers.map(t => `  - ${t.sheet} (${t.voltage}): worst-case mode "${t.worstCaseMode}", minimum ${t.minKva} kVA`).join('\n') || '  (none identified)'}

WORKBOOK HINTS / EXISTING NOTES:
${parsed.notes.map(n => `  - ${n}`).join('\n') || '  (none)'}

Use EXACTLY these columns as JSON keys (use "" when not applicable):
${columns.map(c => `  - "${c}"`).join('\n')}

Return ONLY JSON: { "rows": [ { ${columns.map(c => `"${c}": ""`).join(', ')} } ] }
- One row per equipment item (each generator type, each transformer). Put the standard kVA rating in "Capacity" (or the closest-matching column), the unit ("kVA") in "Unit" if that column exists, and the recommended running+standby count in "Quantity".
- Set "Reference" (or the closest-matching column) to the one-line basis: the computed figure(s) used, the rounding step, and the redundancy assumption.
- If "Discipline"/"System" columns are requested, use "Electrical" / "Power Generation" for generators and "Electrical" / "Power Distribution" for transformers.`;
  const out = await generateJSON(full, { system: ELA_SIZING_SYS, temperature: 0.15, maxOutputTokens: 3000 });
  return Array.isArray(out.rows) ? out.rows : [];
}

router.post('/ela-size', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload an Electrical Load Analysis (ELA) workbook (.xls or .xlsx).' });
    if (!/\.(xlsx|xlsm|xls)$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ error: 'That file does not look like an Excel workbook (.xls/.xlsx). Upload the ELA spreadsheet, not an extracted/converted copy.' });
    }

    const columns = normaliseColumns(req.body.columns).length ? normaliseColumns(req.body.columns) : DEFAULT_COLUMNS.slice();
    const parsed = parseElaWorkbook(req.file.buffer);
    if (!parsed.switchboards.length) {
      return res.status(422).json({ error: 'Could not find any switchboard load tables (sheets named e.g. "230V ESB", "415V MSB"…) in this workbook. Check it matches the standard ELA format (a consumer-by-consumer table per switchboard with per-mode D.F. / No. in use / Load(kW) columns).' });
    }

    const marginPct   = req.body.marginPct   !== undefined && req.body.marginPct   !== '' ? Number(req.body.marginPct)   : undefined;
    const powerFactor = req.body.powerFactor !== undefined && req.body.powerFactor !== '' ? Number(req.body.powerFactor) : undefined;
    const summary = summarizeLoads(parsed, { marginPct, powerFactor });

    let rows = [];
    try { rows = await recommendGeneratorsAndTransformers(summary, parsed, columns); }
    catch (e) { return res.status(502).json({ error: `AI sizing recommendation failed: ${e.message}` }); }

    const nameCol = columns.find(c => /equipment|item|material|name/i.test(c)) || columns[0];
    let mapped = rows
      .map(r => { const o = {}; columns.forEach(c => { o[c] = (pickCol(r, c) ?? '').toString().trim(); }); return o; })
      .filter(o => columns.some(c => o[c]));
    if (!mapped.length) return res.status(502).json({ error: 'The AI did not return any generator/transformer recommendations. Try again.' });
    mapped = validateAndCorrectSizing(mapped, columns, summary);

    res.json({
      columns,
      rows: mapped,
      nameCol,
      summary,
      switchboards: parsed.switchboards.map(s => ({ sheet: s.sheet, voltage: s.voltage, bus: s.bus, consumerCount: s.consumerCount, modes: s.modes })),
      notes: parsed.notes,
      sourceName: req.file.originalname,
    });
  } catch (err) {
    console.error('[/api/bom/ela-size]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// The SOTR is emitted in the standard HSL tender format (as per the HDCS
// Tender Technical Specification): a cover block, a list of contents, and a set
// of numbered CHAPTERS, each a table of numbered CLAUSES against which the
// vendor records "Complied / Not Complied". The model returns a structured JSON
// document (schema below); renderSotrMarkdown() turns it into the markdown that
// drives the on-screen preview and the Word/PDF/TXT exports.
const SOTR_DOC_SYS = `You are a design engineer at Hindustan Shipyard Limited (HSL) drafting a formal Tender Technical Specification / Statement of Technical Requirements (SOTR) in HSL's standard tender format.
The SOTR is organised into numbered CHAPTERS, each containing numbered CLAUSES. Every clause states ONE discrete, verifiable technical requirement in specification language ("The system shall…", "The equipment should…"), because a vendor later records a "Complied / Not Complied" reply against each clause.
Mirror this standard chapter skeleton (omit a chapter only if the source has nothing relevant to it):
  01 GENERAL INFORMATION            - introduction and aim/scope of the system
  02 OPERATIONAL REQUIREMENTS       - system characteristics, configuration, positions/units, controls, operating features
  03 TECHNICAL SPECIFICATIONS       - technology, ratings, power supply, frequencies, interfaces, performance figures
  04 ENVIRONMENTAL SPECIFICATIONS   - type tests, temperature/humidity/salt mist, ingress protection (IP), shock, EMI/EMC
  05 RELIABILITY AND MAINTAINABILITY SPECIFICATION - reliability, MTBF/MTTR, BITE, product support
  06 GENERAL REQUIREMENTS           - scope of supply, installation, spares, documentation, trials (FAT/HAT/SAT), training, guarantee, packing/shipping
Ground every clause in the supplied requirement notes. Do NOT invent specific numeric values absent from the notes — where the source is silent on a standard clause, write the requirement generically (e.g. "shall comply with applicable IRS/IACS rules and IN standards") rather than fabricating figures. Keep each clause to one or two sentences on a single line.`;

const SOTR_NOTE_SYS = `You are a shipbuilding design engineer reading a build specification / RFP to harvest the technical requirements needed to draft a Statement of Technical Requirements (SOTR).
For each equipment, system or material covered in the section, capture: scope/purpose, technical particulars & capacity/ratings, applicable standards/class (IRS/IACS) rules, interface & environmental requirements, documentation/test/certification requirements, and warranty/spares. Quote figures faithfully and cite the nearest "----- Page N -----" marker. Never invent requirements.`;

// ── Structured-document → HDCS-format markdown ───────────────────────────────
// Renders a clause cell to one clean line (the export/preview table parsers are
// line-based, so collapse newlines and neutralise stray pipes).
function cellEsc(v) {
  return String(v == null ? '' : v)
    .replace(/\r?\n+/g, ' ')
    .replace(/\s*\|\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}
function mdTable(columns, rows) {
  const head = `| ${columns.map(cellEsc).join(' | ')} |`;
  const sep  = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(cellEsc).join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

// Turn the structured SOTR document into HSL-tender-format markdown. This is the
// single source of truth for the preview and every export (Word/PDF/TXT).
function renderSotrMarkdown(doc, fallbackTitle) {
  const m = (doc && doc.meta) || {};
  const title = (m.title || fallbackTitle || 'STATEMENT OF TECHNICAL REQUIREMENTS').trim();
  const chapters = Array.isArray(doc && doc.chapters) ? doc.chapters : [];
  const annexures = Array.isArray(doc && doc.annexures) ? doc.annexures : [];
  const out = [];

  out.push(`# ${title}`, '');
  out.push(`**Ship Builder:** ${m.shipBuilder || 'HINDUSTAN SHIPYARD LIMITED, VISAKHAPATNAM'}`, '');

  const metaRows = [
    ['Project', m.project], ['Client', m.client], ['Document No', m.documentNo],
    ['Yard No', m.yardNo], ['Revision', m.revision], ['Date', m.date],
    ['Prepared By', m.preparedBy], ['Authorized By', m.authorizedBy],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  if (metaRows.length) { out.push(mdTable(['Field', 'Detail'], metaRows), ''); }

  if (chapters.length) {
    out.push('## LIST OF CONTENTS', '');
    out.push(mdTable(['Chapter', 'Description'],
      chapters.map(c => [`CHAPTER-${c.no}`, c.title])), '');
  }

  for (const c of chapters) {
    out.push(`## CHAPTER ${c.no} - ${c.title}`, '');
    const rows = (Array.isArray(c.clauses) ? c.clauses : []).map(cl => [cl.clauseNo, cl.description, '']);
    out.push(mdTable(['Clause No.', 'Description of Technical Specification', 'Vendor Reply (Complied / Not Complied)'], rows), '');
  }

  if (annexures.length) {
    out.push('## LIST OF ANNEXURES', '');
    out.push(mdTable(['Annexure', 'Description'], annexures.map(a => [a.no || '', a.title || ''])), '');
    for (const a of annexures) {
      if (a.note && String(a.note).trim()) {
        out.push(`### ANNEXURE ${a.no || ''} - ${a.title || ''}`.trim(), '', String(a.note).trim(), '');
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// JSON schema shared by both SOTR entry points (from sources / from BOM).
const SOTR_JSON_SHAPE = `Return ONLY JSON with this exact shape:
{
  "meta": {
    "title": "TENDER TECHNICAL SPECIFICATION FOR PROCUREMENT OF <SYSTEM / EQUIPMENT NAME>",
    "shipBuilder": "HINDUSTAN SHIPYARD LIMITED, VISAKHAPATNAM",
    "project": "<vessel / project name from the source, else ''>",
    "client": "<client from the source, else ''>",
    "documentNo": "<document no from the source, else ''>",
    "yardNo": "<yard no from the source, else ''>",
    "revision": "001",
    "date": "<DD.MM.YYYY if present in source, else ''>",
    "preparedBy": "",
    "authorizedBy": ""
  },
  "chapters": [
    { "no": "01", "title": "GENERAL INFORMATION", "clauses": [ { "clauseNo": "1.1", "description": "..." } ] },
    { "no": "02", "title": "OPERATIONAL REQUIREMENTS", "clauses": [] },
    { "no": "03", "title": "TECHNICAL SPECIFICATIONS", "clauses": [] },
    { "no": "04", "title": "ENVIRONMENTAL SPECIFICATIONS", "clauses": [] },
    { "no": "05", "title": "RELIABILITY AND MAINTAINABILITY SPECIFICATION", "clauses": [] },
    { "no": "06", "title": "GENERAL REQUIREMENTS", "clauses": [] }
  ],
  "annexures": [
    { "no": "1", "title": "Manufacturer's Recommended List of Spares (MRL-OBS) and Base & Depot Spares - ILMS format", "note": "" },
    { "no": "2", "title": "Technical Documentation Format", "note": "" }
  ]
}
Rules:
- Number clauses within each chapter as <chapter>.<n> (e.g. 2.1, 2.2, 2.3), keeping the chapter number without its leading zero (chapter "02" -> clauses 2.x).
- Place every requirement from the notes in the most appropriate chapter; keep each clause to one or two sentences on a single line (no newlines inside a clause).
- Do not fabricate specific figures that are absent from the notes.`;

function validateSotrDoc(doc) {
  if (!doc || !Array.isArray(doc.chapters) || !doc.chapters.some(c => Array.isArray(c.clauses) && c.clauses.length)) {
    const e = new Error('The SOTR could not be structured into chapters and clauses. Please try again or refine the prompt.');
    e.status = 502; throw e;
  }
}

// Extract concise SOTR requirement notes from one chunk of a build spec.
async function sotrNotesForChunk({ name, chunk }, prompt) {
  const full = `Extract the SOTR-relevant technical requirements from this section of "${name}".
${prompt ? `User focus: ${prompt}` : ''}
List each equipment/system found and, beneath it, its requirements grouped by: Scope; Technical particulars; Standards/class rules; Interfaces/environment; Documentation/testing/certification; Warranty/spares. Note the page number from the nearest "----- Page N -----" marker. If this section contains nothing SOTR-relevant, reply with exactly "NONE".

SECTION CONTENT:
${chunk}`;
  const out = await generateText(full, { system: SOTR_NOTE_SYS, temperature: 0.1, maxOutputTokens: 4000 });
  return (out || '').trim();
}

// Draft an SOTR directly from build-specification documents (map-reduce).
async function sotrFromSources(sources, prompt, title) {
  const chunks = chunkSources(sources);
  if (!chunks.length) { const e = new Error('The selected documents have no readable text.'); e.status = 400; throw e; }

  const errors = [];
  const noteBlocks = await mapLimit(chunks, 2, async (c) => {
    try { return await sotrNotesForChunk(c, prompt); }
    catch (e) { errors.push(e.message); return ''; }
  });
  let notes = noteBlocks.filter(n => n && n.toUpperCase() !== 'NONE').join('\n\n');
  if (!notes.trim() && errors.length) { const e = new Error(`AI SOTR generation failed: ${errors[0]}`); e.status = 502; throw e; }
  if (!notes.trim()) { const e = new Error('No technical requirements could be extracted from the selected documents.'); e.status = 422; throw e; }
  // Keep the synthesis prompt within budget.
  if (notes.length > 48000) notes = notes.slice(0, 48000);

  const { block: ruleBlock, citations } = await ragContextBlock(`${prompt} technical requirements standards class rules`, 6);

  // The cover/header of the spec (system name, project, client, document/yard no,
  // date) rarely survives the technical-note extraction, so feed the raw opening
  // of the first source to the synthesis step to populate the cover meta fields.
  const coverExcerpt = (sources.find(s => s && s.text && s.text.trim())?.text || '').slice(0, 2500);

  const full = `From the requirement notes harvested from the build specification below, produce a complete Statement of Technical Requirements in HSL's standard tender (chapter/clause) format as JSON.
${prompt ? `User guidance: ${prompt}` : ''}

DOCUMENT COVER / HEADER (use for the "meta" fields — system/equipment name, project, client, document no, yard no, date; leave a field "" if absent):
${coverExcerpt}

REQUIREMENT NOTES (extracted from the build specification, with page references):
${notes}

APPLICABLE RULE / STANDARD CONTEXT:
${ruleBlock || '(none retrieved)'}

${SOTR_JSON_SHAPE}`;
  const doc = await generateJSON(full, { system: SOTR_DOC_SYS + getFeedbackGuidance('sotr'), temperature: 0.25, maxOutputTokens: 16000 });
  validateSotrDoc(doc);
  const content = renderSotrMarkdown(doc, title);
  return { title: (doc.meta && doc.meta.title) || title, content, document: doc, citations };
}

// Draft an SOTR derived from an approved BOM.
async function sotrFromBom(bom, columns, prompt, title) {
  const cols = Array.isArray(columns) && columns.length ? columns : Object.keys(bom[0]);
  const bomText = bom.slice(0, 120).map((r, i) =>
    `${i + 1}. ` + cols.map(c => `${c}: ${r[c] ?? ''}`).filter(s => !/: $/.test(s)).join(' | ')
  ).join('\n');

  const { block: ruleBlock, citations } = await ragContextBlock(`${prompt} technical requirements standards class rules`, 6);

  const full = `Draft a Statement of Technical Requirements in HSL's standard tender (chapter/clause) format as JSON, derived from this Bill of Materials.
${prompt ? `User guidance: ${prompt}` : ''}

BILL OF MATERIALS:
${bomText}

APPLICABLE RULE / STANDARD CONTEXT:
${ruleBlock || '(none retrieved)'}

${SOTR_JSON_SHAPE}`;
  const doc = await generateJSON(full, { system: SOTR_DOC_SYS + getFeedbackGuidance('sotr'), temperature: 0.25, maxOutputTokens: 16000 });
  validateSotrDoc(doc);
  const content = renderSotrMarkdown(doc, title);
  return { title: (doc.meta && doc.meta.title) || title, content, document: doc, citations };
}

// POST /api/bom/sotr — from build-spec sources (preferred) or from a BOM.
router.post('/sotr', async (req, res) => {
  try {
    const sources = Array.isArray(req.body.sources) ? req.body.sources.filter(s => s && s.text && s.text.trim()) : [];
    const bom     = Array.isArray(req.body.bom) ? req.body.bom : [];
    const prompt  = req.body.prompt || '';
    const title   = req.body.title || 'Statement of Technical Requirements';

    let out;
    if (sources.length)   out = await sotrFromSources(sources, prompt, title);
    else if (bom.length)  out = await sotrFromBom(bom, req.body.columns, prompt, title);
    else return res.status(400).json({ error: 'Provide build-specification documents (or a BOM) to generate an SOTR from.' });

    res.json(out);
  } catch (err) {
    console.error('[/api/bom/sotr]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
