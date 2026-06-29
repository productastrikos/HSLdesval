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
const { generateJSON, generateText } = require('../lib/llm');
const { mapLimit, ragContextBlock } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');

const router = express.Router();

const DEFAULT_COLUMNS = ['Equipment Name', 'OEM', 'Capacity', 'Quantity', 'Page Number', 'Reference'];

const BOM_SYS = `You are a senior shipbuilding estimation engineer preparing a Bill of Materials (BOM) from tender and build-specification documents.
You identify every distinct equipment / system / material item the vessel requires, with its maker/OEM (if named), capacity/rating, and the page + clause it is referenced from.
You can ESTIMATE quantities by calculation when asked (e.g. number of PA speakers from a compartment's area/volume, number of light fittings from deck area, cable lengths from runs) — when you estimate, state the basis briefly in the Reference/remarks.
Page markers look like "----- Page 7 -----"; use the nearest preceding marker as the Page Number. Never invent OEM names or values that are not supported — use "" instead.`;

function normaliseColumns(raw) {
  if (Array.isArray(raw)) return raw.map(c => String(c).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  return [];
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
    const normKey = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const pick = (row, col) => {
      if (row[col] != null && row[col] !== '') return row[col];
      const want = normKey(col);
      for (const k of Object.keys(row)) if (normKey(k) === want) return row[k];
      return '';
    };
    const nameCol = columns.find(c => /equipment|item|material|name/i.test(c)) || columns[0];
    const seen = new Map();
    for (const r of rows) {
      const o = {}; columns.forEach(c => { o[c] = (pick(r, c) ?? '').toString().trim(); });
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

const SOTR_SYS = `You are a shipyard design engineer drafting a formal Statement of Technical Requirements (SOTR) from an approved Bill of Materials.
An SOTR specifies, per equipment/system: scope & purpose, technical particulars & capacity, applicable standards/class rules, interface & environmental requirements, documentation/test/certification requirements, and warranty/spares.
Write in clear numbered clauses, grounded in the BOM and any rule context provided. Use Markdown headings (##, ###), bullets and pipe tables.`;

const SOTR_NOTE_SYS = `You are a shipbuilding design engineer reading a build specification / RFP to harvest the technical requirements needed to draft a Statement of Technical Requirements (SOTR).
For each equipment, system or material covered in the section, capture: scope/purpose, technical particulars & capacity/ratings, applicable standards/class (IRS/IACS) rules, interface & environmental requirements, documentation/test/certification requirements, and warranty/spares. Quote figures faithfully and cite the nearest "----- Page N -----" marker. Never invent requirements.`;

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

  const full = `Draft a complete Statement of Technical Requirements (SOTR) from the requirement notes harvested from the build specification below.
${prompt ? `User guidance: ${prompt}` : ''}

REQUIREMENT NOTES (extracted from the build specification, with page references):
${notes}

APPLICABLE RULE / STANDARD CONTEXT:
${ruleBlock || '(none retrieved)'}

Produce a professional SOTR document in Markdown. Start with "# ${title}", then an introduction/scope, then a numbered technical-requirement section per major equipment/system (consolidate duplicates, keep page references), then common requirements (standards, documentation, testing, inspection, warranty, spares). Use headings, bullets and pipe tables. Do not invent requirements beyond the notes and rule context.`;
  const content = await generateText(full, { system: SOTR_SYS + getFeedbackGuidance('sotr'), temperature: 0.3, maxOutputTokens: 8000 });
  return { title, content, citations };
}

// Draft an SOTR derived from an approved BOM.
async function sotrFromBom(bom, columns, prompt, title) {
  const cols = Array.isArray(columns) && columns.length ? columns : Object.keys(bom[0]);
  const bomText = bom.slice(0, 120).map((r, i) =>
    `${i + 1}. ` + cols.map(c => `${c}: ${r[c] ?? ''}`).filter(s => !/: $/.test(s)).join(' | ')
  ).join('\n');

  const { block: ruleBlock, citations } = await ragContextBlock(`${prompt} technical requirements standards class rules`, 6);

  const full = `Draft a Statement of Technical Requirements (SOTR) derived from this Bill of Materials.
${prompt ? `User guidance: ${prompt}` : ''}

BILL OF MATERIALS:
${bomText}

APPLICABLE RULE / STANDARD CONTEXT:
${ruleBlock || '(none retrieved)'}

Produce a complete, professional SOTR document in Markdown. Start with "# ${title}", then an introduction/scope, then a numbered technical requirement section per major equipment/system from the BOM, then common requirements (standards, documentation, testing, inspection, warranty, spares).`;
  const content = await generateText(full, { system: SOTR_SYS + getFeedbackGuidance('sotr'), temperature: 0.3, maxOutputTokens: 8000 });
  return { title, content, citations };
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
