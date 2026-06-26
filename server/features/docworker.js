'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Intelligent Document Converter & Worker
//   - POST /api/docworker/extract  { text|docId, prompt, columns[] }
//        Prompt-driven extraction of ANY information into the user's own custom
//        columns → rows (download as Excel/Word downstream). Fully customizable.
//   - POST /api/docworker/edit     { text|docId, instruction, name }
//        Upload a document and have the AI rewrite/modify/restructure it per the
//        user's instructions → returns the edited document text (→ Word/TXT).
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');

const { generateJSON, generateText } = require('../lib/llm');
const { extractFileText } = require('../lib/extract');
const { resolveDocText, mapLimit } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const EXTRACT_SYS = `You are a meticulous document-data-extraction engine for a shipyard.
You extract exactly what the user asks for from the supplied document into a clean table.
You never invent values: if the document does not state something, you output "" for that cell.
When a page marker like "----- Page 12 -----" precedes content, treat 12 as the page number for rows drawn from that content.`;

function normaliseColumns(raw) {
  if (Array.isArray(raw)) return raw.map(c => String(c).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith('[')) { try { return normaliseColumns(JSON.parse(t)); } catch (_) {} }
    return t.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function windows(text, size = 14000) {
  const paras = String(text || '').split(/\n{2,}/);
  const out = []; let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

async function extractWindow(chunk, prompt, columns) {
  const colSpec = columns.length
    ? `Use EXACTLY these columns as JSON keys (use "" when not present):\n${columns.map(c => `  - "${c}"`).join('\n')}`
    : `Decide the most appropriate, useful columns yourself based on the request.`;
  const shape = columns.length
    ? `{ "rows": [ { ${columns.map(c => `"${c}": ""`).join(', ')} } ] }`
    : `{ "columns": ["..."], "rows": [ { } ] }`;
  const full = `Task: ${prompt || 'Extract the key structured data from this document.'}

${colSpec}

DOCUMENT CONTENT:
${chunk}

Return ONLY JSON of the form: ${shape}
Extract one row per distinct item. Never fabricate values.`;
  return generateJSON(full, { system: EXTRACT_SYS + getFeedbackGuidance('converter'), temperature: 0, maxOutputTokens: 16000 });
}

// POST /api/docworker/extract
router.post('/extract', async (req, res) => {
  try {
    const prompt  = req.body.prompt || '';
    const columns = normaliseColumns(req.body.columns);
    const doc = resolveDocText({ id: req.body.docId, text: req.body.text, name: req.body.name }, 'document');

    let cols = columns;
    const chunks = windows(doc.text);
    const errors = [];
    const parts = await mapLimit(chunks, 2, async (c) => {
      try {
        const out = await extractWindow(c, prompt, cols);
        if (!cols.length && Array.isArray(out.columns) && out.columns.length) cols = normaliseColumns(out.columns);
        return Array.isArray(out.rows) ? out.rows : [];
      } catch (e) { errors.push(e.message); return []; }
    });
    let rows = parts.flat().filter(r => r && typeof r === 'object');
    if (!rows.length && errors.length) return res.status(502).json({ error: `AI extraction failed: ${errors[0]}` });

    if (!cols.length) cols = rows.length ? Object.keys(rows[0]) : [];
    // normalise every row to the column set. Match keys tolerantly so a model
    // that echoes a requested column with different casing/spacing/punctuation
    // does not read as empty (which would drop every row).
    const normKey = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const pick = (row, col) => {
      if (row[col] != null && row[col] !== '') return row[col];
      const want = normKey(col);
      for (const k of Object.keys(row)) if (normKey(k) === want) return row[k];
      return '';
    };
    rows = rows.map(r => { const o = {}; cols.forEach(c => { o[c] = pick(r, c) ?? ''; }); return o; })
               .filter(r => cols.some(c => String(r[c]).trim()));

    res.json({ name: doc.name, columns: cols, rows, rowCount: rows.length });
  } catch (err) {
    console.error('[/api/docworker/extract]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

const EDIT_SYS = `You are an expert shipyard technical editor and document worker.
You revise, restructure, summarise, translate, reformat or rewrite engineering documents exactly as instructed, preserving technical accuracy, clause references, figures and units.
You return the COMPLETE resulting document text (not a description of changes), using Markdown: # / ## / ### for headings, "- " for bullets, blank lines between paragraphs, and Markdown pipe tables where tabular.`;

// POST /api/docworker/edit
router.post('/edit', upload.single('file'), async (req, res) => {
  try {
    const instruction = (req.body.instruction || req.body.prompt || '').trim();
    if (!instruction) return res.status(400).json({ error: 'Provide an instruction describing the changes to make.' });

    let name = req.body.name || '';
    let text = '';
    if (req.file) {
      name = name || req.file.originalname;
      text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    } else {
      const d = resolveDocText({ id: req.body.docId, text: req.body.text, name }, 'document');
      text = d.text; name = name || d.name;
    }
    if (!text || !text.trim()) return res.status(422).json({ error: 'Could not read the document to edit.' });

    const prompt = `Apply the following change to the document and return the COMPLETE revised document.

CHANGE REQUESTED:
${instruction}

ORIGINAL DOCUMENT (${name}):
${text.slice(0, 36000)}

Return the full revised document text only.`;
    const content = await generateText(prompt, { system: EDIT_SYS + getFeedbackGuidance('docworker'), temperature: 0.2, maxOutputTokens: 8000 });
    res.json({ name, instruction, content });
  } catch (err) {
    console.error('[/api/docworker/edit]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
