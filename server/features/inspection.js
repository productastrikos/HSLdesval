'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Inspection Reports Analytics  (formerly Inspection Report Converter)
// Processes inspection reports / NCRs / trial reports (incl. handwritten images
// via vision OCR), automatically classifies every observation, tracks status
// (Open / Closed) and powers an equipment-wise analytics dashboard.
//   - POST  /api/inspection/analyze            file | docId | text → classified rows (persisted)
//   - GET   /api/inspection/observations       list persisted observations (filters)
//   - PATCH /api/inspection/observations/:id    update status / closure remark
//   - GET   /api/inspection/analytics          equipment-wise + category/severity tallies
// Categories: Material · Design/Drawing · Workmanship · Installation ·
//             Documentation · Testing and Commissioning
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');

const { generateJSON } = require('../lib/llm');
const { extractFileText } = require('../lib/extract');
const { resolveDocText, mapLimit } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');
const store = require('../lib/store');
const { CATEGORIES, COLLECTION } = require('./lessons');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
const INSPECTIONS = 'inspections';   // persisted, status-tracked observations

const SYSTEM = `You are a senior QA/QC and design-review engineer at a shipyard processing inspection reports to build a cross-project Lessons-Learned repository and an equipment-wise analytics view.
You read inspection reports, audit reports, NCRs, survey reports and trial reports — including handwritten ones — and extract every distinct observation, non-conformity and remark.
You classify rigorously and never invent findings that are not in the text.`;

function windows(text, size = 14000) {
  const paras = text.split(/\n{2,}/);
  const out = []; let buf = '';
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
  "system":         "",   // affected system/equipment (e.g. "MB/SRE", "Steering Gear", "HVAC") — this is the EQUIPMENT for analytics
  "discipline":     "",   // engineering discipline (Structural, Electrical, Mechanical, Piping, Outfit, Coating…)
  "severity":       "critical" | "high" | "medium" | "low",
  "satUnsat":       "SAT" | "UNSAT" | "",  // SAT if satisfactory/accepted/passed; UNSAT if defect/non-conformance/failed; else ""
  "rootCause":      "",   // likely root cause if inferable, else ""
  "recommendation": "",   // corrective / preventive action or design consideration
  "clauseRef":      ""    // applicable rule/standard clause if identifiable, else ""
} ] }

Rules:
- One row per distinct finding. Always fill "system" with the best equipment/system name (for the equipment-wise dashboard).
- "Non-Conformity" = a clear breach; "Observation" = a noted issue/risk; "Remark" = advisory note.
- If the extract contains no findings, return { "observations": [] }.
Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('inspection'), maxOutputTokens: 16384, temperature: 0.1 });
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

    observations = observations
      .filter(o => o && o.observation && o.observation.trim())
      .map((o, i) => ({
        slNo: i + 1,
        ...o,
        category: CATEGORIES.includes(o.category) ? o.category : 'Documentation',
        satUnsat: ['SAT', 'UNSAT'].includes((o.satUnsat || '').toUpperCase()) ? o.satUnsat.toUpperCase() : '',
        status: 'Open',
        project: project || '',
        report: reportName,
      }));

    const byCategory = {};
    for (const c of CATEGORIES) byCategory[c] = 0;
    for (const o of observations) byCategory[o.category] = (byCategory[o.category] || 0) + 1;

    // Persist for status tracking + analytics
    const persisted = store.insertMany(INSPECTIONS, observations.map(o => ({
      observation: o.observation, type: o.type || 'Observation', category: o.category,
      system: o.system || 'Unspecified', discipline: o.discipline || '', severity: o.severity || 'medium',
      satUnsat: o.satUnsat || '', status: 'Open', closureRemark: '',
      recommendation: o.recommendation || '', reportRef: o.reportRef || '', clauseRef: o.clauseRef || '',
      project: project || '', report: reportName, addedBy: req.user?.username || 'system',
    })));
    // attach persisted ids back so the UI can close remarks immediately
    observations = observations.map((o, i) => ({ ...o, id: persisted[i]?.id }));

    // Feed Lessons-Learned
    let savedCount = 0;
    if (saveToLL && observations.length) {
      const created = store.insertMany(COLLECTION, observations.map(o => ({
        observation: o.observation, category: o.category, system: o.system || '', project: project || '',
        severity: o.severity || 'medium', recommendation: o.recommendation || '', discipline: o.discipline || '',
        reportRef: o.reportRef || '', clauseRef: o.clauseRef || '',
        source: `inspection:${reportName}`, addedBy: req.user?.username || 'system',
      })));
      savedCount = created.length;
    }

    res.json({
      report: reportName, project, categories: CATEGORIES,
      total: observations.length, byCategory, observations, savedToLessons: savedCount,
    });
  } catch (err) {
    console.error('[/api/inspection/analyze]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── GET /api/inspection/observations ─────────────────────────────────────────
router.get('/observations', (req, res) => {
  const { status = '', system = '', project = '', category = '' } = req.query;
  let items = store.readAll(INSPECTIONS);
  if (status)   items = items.filter(o => (o.status || '').toLowerCase() === status.toLowerCase());
  if (system)   items = items.filter(o => (o.system || '').toLowerCase().includes(system.toLowerCase()));
  if (project)  items = items.filter(o => (o.project || '').toLowerCase().includes(project.toLowerCase()));
  if (category) items = items.filter(o => (o.category || '').toLowerCase() === category.toLowerCase());
  res.json({ total: store.readAll(INSPECTIONS).length, count: items.length, observations: items });
});

// ── PATCH /api/inspection/observations/:id ───────────────────────────────────
router.patch('/observations/:id', (req, res) => {
  try {
    const all = store.readAll(INSPECTIONS);
    const idx = all.findIndex(o => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Observation not found.' });
    const { status, closureRemark } = req.body || {};
    if (status && !['Open', 'Closed'].includes(status)) return res.status(400).json({ error: 'status must be Open or Closed.' });
    if (status) all[idx].status = status;
    if (closureRemark !== undefined) all[idx].closureRemark = String(closureRemark).slice(0, 2000);
    all[idx].updatedAt = new Date().toISOString();
    all[idx].updatedBy = req.user?.username || 'unknown';
    store.writeAll(INSPECTIONS, all);
    res.json({ ok: true, observation: all[idx] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── GET /api/inspection/analytics  (equipment-wise) ──────────────────────────
router.get('/analytics', (req, res) => {
  const { project = '' } = req.query;
  let items = store.readAll(INSPECTIONS);
  if (project) items = items.filter(o => (o.project || '').toLowerCase().includes(project.toLowerCase()));

  const blank = () => ({ total: 0, open: 0, closed: 0, critical: 0, high: 0, unsat: 0 });
  const byEquipment = {}, byCategory = {}, bySeverity = {}, byProject = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  let open = 0, closed = 0, unsat = 0;

  for (const o of items) {
    const eq = o.system || 'Unspecified';
    byEquipment[eq] = byEquipment[eq] || blank();
    byEquipment[eq].total++;
    if ((o.status || 'Open') === 'Closed') { byEquipment[eq].closed++; closed++; } else { byEquipment[eq].open++; open++; }
    if (o.severity === 'critical') byEquipment[eq].critical++;
    if (o.severity === 'high') byEquipment[eq].high++;
    if ((o.satUnsat || '') === 'UNSAT') { byEquipment[eq].unsat++; unsat++; }
    byCategory[o.category] = (byCategory[o.category] || 0) + 1;
    bySeverity[o.severity || 'medium'] = (bySeverity[o.severity || 'medium'] || 0) + 1;
    const pj = o.project || 'Unspecified';
    byProject[pj] = (byProject[pj] || 0) + 1;
  }

  const equipmentRows = Object.entries(byEquipment)
    .map(([equipment, s]) => ({ equipment, ...s }))
    .sort((a, b) => b.total - a.total);

  res.json({
    total: items.length, open, closed, unsat,
    categories: CATEGORIES, byCategory, bySeverity, byProject,
    equipment: equipmentRows,
  });
});

module.exports = router;
