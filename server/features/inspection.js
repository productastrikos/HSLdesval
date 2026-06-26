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

async function classifyWindow(chunk, { project, reportName, header }) {
  const prompt = `Extract and classify EVERY observation, non-conformity (NCR) and remark from this inspection-report extract.

Project: ${project || '(unspecified)'}
Report: ${reportName || '(unspecified)'}
${header ? `\nREPORT HEADER CONTEXT (project, inspection agency, date, document no, signatory usually appear here — read them and repeat on every row):\n${header}\n` : ''}
INSPECTION REPORT EXTRACT:
${chunk}

Return JSON: { "observations": [ {
  "reportRef":      "",   // clause / item / para number in the report if shown, else ""
  "observation":    "",   // the finding / remark, stated precisely and self-contained — this is the "Description of the remark"
  "type":           "Observation" | "Non-Conformity" | "Remark",
  "category":       ${JSON.stringify(CATEGORIES)} (choose the single best fit) — this is the "classification of the remark",
  "system":         "",   // affected system/equipment/material (e.g. "MB/SRE", "Steering Gear", "HVAC") — this is the EQUIPMENT for analytics
  "discipline":     "",   // engineering discipline (Structural, Electrical, Mechanical, Piping, Outfit, Coating…)
  "agency":         "",   // name of the inspection / surveying agency or inspector (e.g. "WATT", "IRS", "Owner", "QA"), from the header if not on the row
  "date":           "",   // date of the inspection (as written, e.g. "12 Mar 2025"), from the header if not on the row, else ""
  "documentNo":     "",   // the report / document number if any (header), else ""
  "trialNo":        "",   // trial serial number / item no for this finding if shown, else ""
  "signedBy":       "",   // name/designation of the person who signed/raised the report (header), else ""
  "severity":       "critical" | "high" | "medium" | "low",
  "satUnsat":       "SAT" | "UNSAT" | "",  // SAT if satisfactory/accepted/passed; UNSAT if defect/non-conformance/failed; else ""
  "rootCause":      "",   // likely root cause if inferable, else ""
  "recommendation": "",   // corrective / preventive action or design consideration
  "clauseRef":      ""    // applicable rule/standard clause if identifiable, else ""
} ] }

Rules:
- One row per distinct finding. Always fill "system" with the best equipment/system/material name (for the equipment-wise dashboard).
- "agency", "date", "documentNo" and "signedBy" usually appear ONCE in the report header — repeat them on every row where applicable.
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
    // The first ~1500 chars usually hold the report header (agency, date, document
    // no, signatory) — pass it to every window so those columns fill on each row.
    const header = text.slice(0, 1500);
    const errors = [];
    const results = await mapLimit(chunks, 3, async (c) => {
      try { return await classifyWindow(c, { project, reportName, header }); }
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
        date: o.date || '',
        documentNo: o.documentNo || '',
        trialNo: o.trialNo || '',
        signedBy: o.signedBy || '',
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
      system: o.system || 'Unspecified', discipline: o.discipline || '', agency: o.agency || '',
      date: o.date || '', documentNo: o.documentNo || '', trialNo: o.trialNo || '', signedBy: o.signedBy || '',
      severity: o.severity || 'medium',
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

// Status workflow per HSL MVP item 8: Open / Under Action / Closed / Deferred.
const STATUSES = ['Open', 'Under Action', 'Closed', 'Deferred'];

// ── GET /api/inspection/observations ─────────────────────────────────────────
function applyFilters(items, q) {
  const { status = '', system = '', project = '', category = '', discipline = '', agency = '', from = '', to = '' } = q;
  const lc = s => String(s).toLowerCase();
  if (status)     items = items.filter(o => lc(o.status || 'Open') === lc(status));
  if (system)     items = items.filter(o => lc(o.system).includes(lc(system)));
  if (project)    items = items.filter(o => lc(o.project).includes(lc(project)));
  if (category)   items = items.filter(o => lc(o.category) === lc(category));
  if (discipline) items = items.filter(o => lc(o.discipline).includes(lc(discipline)));
  if (agency)     items = items.filter(o => lc(o.agency).includes(lc(agency)));
  if (from)       items = items.filter(o => (o.createdAt || '') >= from);
  if (to)         items = items.filter(o => (o.createdAt || '') <= to);
  return items;
}

router.get('/observations', (req, res) => {
  const items = applyFilters(store.readAll(INSPECTIONS), req.query);
  res.json({ total: store.readAll(INSPECTIONS).length, count: items.length, statuses: STATUSES, observations: items });
});

// ── PATCH /api/inspection/observations/:id ───────────────────────────────────
// Maintains a per-observation change history (audit trail) in addition to the
// application-wide audit log.
router.patch('/observations/:id', (req, res) => {
  try {
    const all = store.readAll(INSPECTIONS);
    const idx = all.findIndex(o => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Observation not found.' });
    const { status, closureRemark } = req.body || {};
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}.` });
    const prev = all[idx].status || 'Open';
    if (status) all[idx].status = status;
    if (closureRemark !== undefined) all[idx].closureRemark = String(closureRemark).slice(0, 2000);
    const when = new Date().toISOString();
    const who  = req.user?.username || 'unknown';
    all[idx].updatedAt = when;
    all[idx].updatedBy = who;
    all[idx].history = [...(all[idx].history || []), {
      at: when, by: who, from: prev, to: status || prev,
      remark: closureRemark !== undefined ? String(closureRemark).slice(0, 500) : '',
    }];
    store.writeAll(INSPECTIONS, all);
    res.json({ ok: true, observation: all[idx] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── GET /api/inspection/analytics  (configurable, equipment-wise) ────────────
// Filters: project, system, discipline, agency, category, status, from, to.
router.get('/analytics', (req, res) => {
  const items = applyFilters(store.readAll(INSPECTIONS), req.query);

  const blank = () => ({ total: 0, open: 0, closed: 0, critical: 0, high: 0, unsat: 0 });
  const byEquipment = {}, byCategory = {}, bySeverity = {}, byProject = {}, byAgency = {}, byDiscipline = {}, byStatus = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  for (const s of STATUSES) byStatus[s] = 0;
  let open = 0, closed = 0, unsat = 0;

  for (const o of items) {
    const eq = o.system || 'Unspecified';
    const isClosed = (o.status || 'Open') === 'Closed';
    byEquipment[eq] = byEquipment[eq] || blank();
    byEquipment[eq].total++;
    if (isClosed) { byEquipment[eq].closed++; closed++; } else { byEquipment[eq].open++; open++; }
    if (o.severity === 'critical') byEquipment[eq].critical++;
    if (o.severity === 'high') byEquipment[eq].high++;
    if ((o.satUnsat || '') === 'UNSAT') { byEquipment[eq].unsat++; unsat++; }
    byCategory[o.category] = (byCategory[o.category] || 0) + 1;
    bySeverity[o.severity || 'medium'] = (bySeverity[o.severity || 'medium'] || 0) + 1;
    byProject[o.project || 'Unspecified'] = (byProject[o.project || 'Unspecified'] || 0) + 1;
    byStatus[o.status || 'Open'] = (byStatus[o.status || 'Open'] || 0) + 1;
    if (o.agency)     byAgency[o.agency] = (byAgency[o.agency] || 0) + 1;
    if (o.discipline) byDiscipline[o.discipline] = (byDiscipline[o.discipline] || 0) + 1;
  }

  const equipmentRows = Object.entries(byEquipment)
    .map(([equipment, s]) => ({ equipment, ...s }))
    .sort((a, b) => b.total - a.total);

  res.json({
    total: items.length, open, closed, unsat,
    categories: CATEGORIES, statuses: STATUSES,
    byCategory, bySeverity, byProject, byAgency, byDiscipline, byStatus,
    equipment: equipmentRows,
  });
});

// ── POST /api/inspection/query  (natural-language Q&A over observations) ──────
// e.g. "How many UNSAT remarks were raised by WATT in Project X?",
//      "List all Material Related remarks for MB/SRE System."
router.post('/query', async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Provide a question.' });
    const all = applyFilters(store.readAll(INSPECTIONS), req.body || {});
    if (!all.length) return res.json({ answer: 'There are no inspection observations recorded yet. Analyse an inspection report first.', rows: [], count: 0 });

    // Compact rows for grounding (cap to bound the prompt).
    const compact = all.slice(0, 600).map(o => ({
      id: o.id, observation: (o.observation || '').slice(0, 240), category: o.category,
      system: o.system, discipline: o.discipline, agency: o.agency, severity: o.severity,
      satUnsat: o.satUnsat, status: o.status || 'Open', project: o.project, report: o.report, reportRef: o.reportRef,
    }));

    const prompt = `You are answering a question STRICTLY from the inspection-observation dataset below. Do not invent data.

QUESTION: ${question}

DATASET (${compact.length} observations as JSON):
${JSON.stringify(compact)}

Return JSON:
{
  "answer": "a precise natural-language answer. If the question asks 'how many', give the exact count. If it asks to 'list', summarise what was found.",
  "count": 0,                       // number of matching observations
  "matchedIds": ["id", ...]         // ids of the observations that match the question (for the table)
}
Output ONLY the JSON.`;
    const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('inspection'), maxOutputTokens: 4096, temperature: 0.1 });
    const ids = new Set(Array.isArray(out.matchedIds) ? out.matchedIds : []);
    const rows = all.filter(o => ids.has(o.id)).map(o => ({
      'Sl.No': 0, 'Observation': o.observation, 'Category': o.category, 'System/Equipment': o.system,
      'Discipline': o.discipline, 'Agency': o.agency, 'SAT/UNSAT': o.satUnsat, 'Severity': o.severity,
      'Status': o.status || 'Open', 'Project': o.project, 'Report': o.report,
    })).map((r, i) => ({ ...r, 'Sl.No': i + 1 }));

    res.json({ answer: out.answer || '', count: typeof out.count === 'number' ? out.count : rows.length, rows });
  } catch (err) {
    console.error('[/api/inspection/query]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
