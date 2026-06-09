'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Document Intelligent Converter — Inspection Reports
// Processes inspection reports of any project, automatically extracting
// observations, non-conformities and remarks, and classifying them into:
//   Material · Design/Drawing · Workmanship · Installation · Documentation ·
//   Testing and Commissioning
// Produces structured rows (→ Excel) and feeds the Lessons-Learned repository.
//   - POST /api/inspection/analyze   file | docId | text  →  classified rows
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');

const { generateJSON } = require('../lib/llm');
const { extractFileText } = require('../lib/extract');
const { resolveDocText, mapLimit } = require('./_util');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');
const store = require('../lib/store');
const { CATEGORIES, COLLECTION } = require('./lessons');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const SYSTEM = `You are a senior QA/QC and design-review engineer at a shipyard processing inspection reports to build a cross-project Lessons-Learned repository.
You read inspection reports, audit reports, NCRs, survey reports and trial reports, and you extract every distinct observation, non-conformity and remark.
You classify rigorously and never invent findings that are not in the text.`;

// Split long text into windows on paragraph boundaries.
function windows(text, size = 14000) {
  const paras = text.split(/\n{2,}/);
  const out = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

async function classifyWindow(chunk, { project, reportName }) {
  const prompt = `Extract and classify EVERY observation, non-conformity (NCR) and remark from this inspection-report extract.

Project: ${project || '(unspecified)'}
Report: ${reportName || '(unspecified)'}

INSPECTION REPORT EXTRACT:
${chunk}

Return JSON: { "observations": [ {
  "reportRef":      "",   // clause / item / para number in the report if shown, else ""
  "observation":    "",   // the finding, stated precisely and self-contained
  "type":           "Observation" | "Non-Conformity" | "Remark",
  "category":       ${JSON.stringify(CATEGORIES)} (choose the single best fit),
  "system":         "",   // affected system/equipment (e.g. "MB/SRE", "Hull", "HVAC")
  "discipline":     "",   // engineering discipline (Structural, Electrical, Mechanical, Piping, Outfit, Coating…)
  "severity":       "critical" | "high" | "medium" | "low",
  "rootCause":      "",   // likely root cause if inferable, else ""
  "recommendation": "",   // corrective / preventive action or design consideration
  "clauseRef":      ""    // applicable rule/standard clause if identifiable, else ""
} ] }

Rules:
- One row per distinct finding. Do NOT merge unrelated findings.
- "Non-Conformity" = a clear breach of requirement/standard; "Observation" = a noted issue/risk; "Remark" = advisory note.
- If the extract contains no findings, return { "observations": [] }.
Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM, maxOutputTokens: 16384, temperature: 0.1 });
  return Array.isArray(out.observations) ? out.observations : [];
}

// ── POST /api/inspection/analyze ─────────────────────────────────────────────
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    const project   = req.body.project || '';
    const saveToLL  = String(req.body.saveToLessons ?? 'true') !== 'false';
    let reportName  = req.body.name || '';
    let text        = '';

    if (req.file) {
      reportName = reportName || req.file.originalname;
      text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    } else if (req.body.docId || req.body.text) {
      const r = resolveDocText({ id: req.body.docId, text: req.body.text, name: reportName }, 'inspection report');
      text = r.text; reportName = reportName || r.name;
    } else {
      return res.status(400).json({ error: 'Provide a file, a docId, or text.' });
    }

    if (!text || !text.trim()) return res.status(422).json({ error: 'Could not extract text from the report.' });

    const chunks = windows(text);
    const errors = [];
    const results = await mapLimit(chunks, 3, async (c) => {
      try { return await classifyWindow(c, { project, reportName }); }
      catch (e) { errors.push(e.message); return []; }
    });
    let observations = results.flat();
    if (!observations.length && errors.length) {
      return res.status(502).json({ error: `AI classification failed: ${errors[0]}` });
    }

    // Renumber + tag provenance
    observations = observations
      .filter(o => o && o.observation && o.observation.trim())
      .map((o, i) => ({
        slNo: i + 1,
        ...o,
        category: CATEGORIES.includes(o.category) ? o.category : 'Documentation',
        project: project || '',
        report: reportName,
      }));

    // Category tally
    const byCategory = {};
    for (const c of CATEGORIES) byCategory[c] = 0;
    for (const o of observations) byCategory[o.category] = (byCategory[o.category] || 0) + 1;

    // Feed the Lessons-Learned repository
    let savedCount = 0;
    if (saveToLL && observations.length) {
      const created = store.insertMany(COLLECTION, observations.map(o => ({
        observation: o.observation,
        category: o.category,
        system: o.system || '',
        project: project || '',
        severity: o.severity || 'medium',
        recommendation: o.recommendation || '',
        discipline: o.discipline || '',
        reportRef: o.reportRef || '',
        clauseRef: o.clauseRef || '',
        source: `inspection:${reportName}`,
        addedBy: req.user?.username || 'system',
      })));
      savedCount = created.length;
    }

    res.json({
      report: reportName,
      project,
      categories: CATEGORIES,
      total: observations.length,
      byCategory,
      observations,
      savedToLessons: savedCount,
    });
  } catch (err) {
    console.error('[/api/inspection/analyze]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
