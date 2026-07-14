'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Accuracy-Evaluation Harness  (/api/eval, admin only)
//
// Proves — measurably — the spec's §3g acceptance criteria:
//   • Accuracy of detection > 95%
//   • Maximum false negatives ≤ 5%
//
// It runs the labelled benchmark (server/eval/dataset.js) through the REAL
// pipeline (KB retrieval + the inference engine), collects the model's boolean
// compliance verdict per case, and computes a confusion matrix and metrics.
//
//   GET  /api/eval/dataset → the benchmark cases
//   POST /api/eval/run     → run the benchmark, return + persist metrics + results
//   GET  /api/eval/runs    → history of previous runs (summaries)
//   GET  /api/eval/runs/:id → one run in full
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');

const { CASES } = require('../eval/dataset');
const { generateJSON } = require('../lib/llm');
const { ragContextBlock, mapLimit } = require('./_util');
const store = require('../lib/store');

const router = express.Router();

const TARGET_ACCURACY = 0.95;   // §3g: accuracy of detection > 95%
const TARGET_FN_RATE  = 0.05;   // §3g: maximum false negatives ≤ 5%

// Assess one case: retrieve KB context, ask for a strict boolean verdict.
async function assess(item) {
  let context = '';
  try { context = (await ragContextBlock(item.statement, 6)).block; } catch (_) { context = ''; }

  const prompt = `You are a ship-design compliance checker for a naval/commercial shipyard. Assess the DESIGN STATEMENT below against applicable classification (IRS/DNV/ABS/IACS), IMO (SOLAS/MARPOL), IEC 60092 and naval requirements.

DESIGN STATEMENT:
"${item.statement}"

APPLICABLE REFERENCES (retrieved from the knowledge base — may be partial; use domain knowledge to fill gaps):
${context || '(none retrieved)'}

Decide whether the statement describes a NON-COMPLIANCE (a violation of, or failure to meet, a rule/requirement).
Respond with ONLY valid JSON: {"issue": true, "reason": "<one short sentence>"}
 - "issue": true  → the statement is non-compliant / violates a requirement.
 - "issue": false → the statement is acceptable / compliant.`;

  const out = await generateJSON(prompt, { temperature: 0, maxOutputTokens: 300 });
  const predicted = out?.issue === true || out?.issue === 'true';
  return { predicted, reason: (out && out.reason) ? String(out.reason).slice(0, 400) : '' };
}

function computeMetrics(results) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const cat = {};   // category → { correct, total }
  for (const r of results) {
    if (r.error) continue;
    const exp = r.expectedIssue, pred = r.predictedIssue;
    if (exp && pred) tp++;
    else if (exp && !pred) fn++;
    else if (!exp && pred) fp++;
    else tn++;
    const c = cat[r.category] || (cat[r.category] = { correct: 0, total: 0 });
    c.total++; if (r.correct) c.correct++;
  }
  const scored = tp + fp + tn + fn;
  const actualPos = tp + fn;
  const actualNeg = tn + fp;
  const round = (x) => Math.round(x * 1000) / 1000;

  const accuracy          = scored ? (tp + tn) / scored : 0;
  const falseNegativeRate = actualPos ? fn / actualPos : 0;
  const falsePositiveRate = actualNeg ? fp / actualNeg : 0;
  const precision         = (tp + fp) ? tp / (tp + fp) : 0;
  const recall            = actualPos ? tp / actualPos : 0;         // = 1 − FN rate
  const f1                = (precision + recall) ? 2 * precision * recall / (precision + recall) : 0;

  return {
    total: results.length, scored, tp, fp, tn, fn,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    falseNegativeRate: round(falseNegativeRate),
    falsePositiveRate: round(falsePositiveRate),
    targets: { accuracy: TARGET_ACCURACY, falseNegativeRate: TARGET_FN_RATE },
    passAccuracy: accuracy >= TARGET_ACCURACY,
    passFalseNegatives: falseNegativeRate <= TARGET_FN_RATE,
    pass: accuracy >= TARGET_ACCURACY && falseNegativeRate <= TARGET_FN_RATE,
    byCategory: Object.fromEntries(Object.entries(cat).map(([k, v]) =>
      [k, { correct: v.correct, total: v.total, accuracy: round(v.total ? v.correct / v.total : 0) }])),
  };
}

// GET /api/eval/dataset
router.get('/dataset', (req, res) => {
  res.json({
    count: CASES.length,
    positives: CASES.filter(c => c.expectedIssue).length,
    negatives: CASES.filter(c => !c.expectedIssue).length,
    cases: CASES.map(({ id, category, statement, expectedIssue, basis }) =>
      ({ id, category, statement, expectedIssue, basis })),
  });
});

// POST /api/eval/run
router.post('/run', async (req, res) => {
  try {
    const started = Date.now();
    const results = await mapLimit(CASES, 3, async (item) => {
      try {
        const { predicted, reason } = await assess(item);
        return {
          id: item.id, category: item.category, statement: item.statement,
          expectedIssue: item.expectedIssue, predictedIssue: predicted,
          correct: predicted === item.expectedIssue,
          type: item.expectedIssue ? (predicted ? 'TP' : 'FN') : (predicted ? 'FP' : 'TN'),
          reason,
        };
      } catch (err) {
        return { id: item.id, category: item.category, statement: item.statement,
          expectedIssue: item.expectedIssue, error: err.message };
      }
    });

    const metrics = computeMetrics(results);
    const errors  = results.filter(r => r.error).length;
    const run = {
      ranAt: new Date().toISOString(),
      ranBy: req.user?.username || 'admin',
      durationMs: Date.now() - started,
      datasetSize: CASES.length,
      errors,
      metrics,
      results,
    };
    const saved = store.insert('eval-runs', run);   // keeps full history in data/eval-runs.json
    res.json(saved);
  } catch (err) {
    console.error('[/api/eval/run]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// GET /api/eval/runs → summaries (newest first)
router.get('/runs', (req, res) => {
  const runs = store.readAll('eval-runs').map(r => ({
    id: r.id, ranAt: r.ranAt, ranBy: r.ranBy, durationMs: r.durationMs,
    datasetSize: r.datasetSize, errors: r.errors,
    accuracy: r.metrics?.accuracy, falseNegativeRate: r.metrics?.falseNegativeRate,
    pass: r.metrics?.pass,
  }));
  res.json({ runs });
});

// GET /api/eval/runs/:id → one full run
router.get('/runs/:id', (req, res) => {
  const run = store.readAll('eval-runs').find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json(run);
});

module.exports = router;
