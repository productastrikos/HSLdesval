'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Feedback & Continuous-Learning loop
// Every AI output in the app can be rated Satisfied / Not Satisfied with remarks.
// Feedback is persisted (server/data/feedback.json). "Not Satisfied" remarks are
// fed back into the prompts of the same module as explicit corrections, so the
// assistant visibly improves from user guidance across the session.
//   - POST /api/feedback              { module, rating, remarks, subject }
//   - GET  /api/feedback?module=      list (most recent first)
//   - GET  /api/feedback/stats        per-module satisfied / not-satisfied tally
// getFeedbackGuidance(module) → corrective-guidance block for prompt injection.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const store   = require('../lib/store');

const router = express.Router();
const COLLECTION = 'feedback';
// HSL MVP item 16: Satisfied / Partially Satisfied / Not Satisfied + comments.
const RATINGS = ['satisfied', 'partially_satisfied', 'not_satisfied'];

// ── POST /api/feedback ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { module = 'general', rating, remarks = '', subject = '' } = req.body || {};
    if (!RATINGS.includes(rating)) {
      return res.status(400).json({ error: 'rating must be "satisfied", "partially_satisfied" or "not_satisfied".' });
    }
    const item = store.insert(COLLECTION, {
      module: String(module).slice(0, 60),
      rating,
      remarks: String(remarks || '').slice(0, 4000),
      subject: String(subject || '').slice(0, 300),
      addedBy: req.user?.username || 'unknown',
    });
    res.status(201).json({ ok: true, id: item.id });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── GET /api/feedback ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { module = '' } = req.query;
  let items = store.readAll(COLLECTION);
  if (module) items = items.filter(f => (f.module || '').toLowerCase() === module.toLowerCase());
  res.json({ total: items.length, feedback: items });
});

// ── GET /api/feedback/stats ───────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const items = store.readAll(COLLECTION);
  const byModule = {};
  for (const f of items) {
    const m = f.module || 'general';
    byModule[m] = byModule[m] || { satisfied: 0, partially_satisfied: 0, not_satisfied: 0 };
    if (byModule[m][f.rating] !== undefined) byModule[m][f.rating]++;
  }
  const satisfied = items.filter(f => f.rating === 'satisfied').length;
  const partially = items.filter(f => f.rating === 'partially_satisfied').length;
  const notSatisfied = items.filter(f => f.rating === 'not_satisfied').length;
  res.json({ total: items.length, satisfied, partiallySatisfied: partially, notSatisfied, byModule });
});

// ── Continuous-learning: corrective guidance for a module's prompts ───────────
// Both "not satisfied" and "partially satisfied" remarks carry corrections.
function getFeedbackGuidance(module, limit = 5) {
  try {
    const items = store.readAll(COLLECTION)
      .filter(f => (f.rating === 'not_satisfied' || f.rating === 'partially_satisfied') && (f.remarks || '').trim()
        && (!module || (f.module || '').toLowerCase() === module.toLowerCase()))
      .slice(0, limit);
    if (!items.length) return '';
    const bullets = items.map(f => `- ${f.remarks.trim()}${f.subject ? ` (re: ${f.subject})` : ''}`).join('\n');
    return `\n\nCONTINUOUS-LEARNING — the user previously flagged outputs here as unsatisfactory and asked for these corrections. Apply them:\n${bullets}\n`;
  } catch (_) {
    return '';
  }
}

module.exports = { router, getFeedbackGuidance };
