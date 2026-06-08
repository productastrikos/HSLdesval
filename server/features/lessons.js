'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Lessons-Learned Repository
// A durable, searchable knowledge base of observations / non-conformities /
// remarks captured from inspection reports across projects, classified into
// engineering categories. Supports:
//   - GET    /api/lessons            list + keyword/category/system filtering
//   - POST   /api/lessons            add a lesson manually
//   - DELETE /api/lessons/:id        remove a lesson
//   - POST   /api/lessons/suggest    PROACTIVE — given the system a designer is
//                                    working on, surface relevant lessons,
//                                    recurring issues and recommended design
//                                    considerations (lessons store + RAG + AI).
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const store   = require('../lib/store');
const { generateJSON } = require('../lib/llm');
const { ragContextBlock } = require('./_util');

const router = express.Router();
const COLLECTION = 'lessons';

const CATEGORIES = [
  'Material',
  'Design/Drawing',
  'Workmanship',
  'Installation',
  'Documentation',
  'Testing and Commissioning',
];

function tokenScore(text, terms) {
  const hay = (text || '').toLowerCase();
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
}

// ── GET /api/lessons ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { q = '', category = '', system = '', project = '' } = req.query;
  let items = store.readAll(COLLECTION);

  if (category) items = items.filter(l => (l.category || '').toLowerCase() === category.toLowerCase());
  if (system)   items = items.filter(l => (l.system || '').toLowerCase().includes(system.toLowerCase()));
  if (project)  items = items.filter(l => (l.project || '').toLowerCase().includes(project.toLowerCase()));

  if (q.trim()) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    items = items
      .map(l => ({ l, s: tokenScore([l.observation, l.category, l.system, l.project, l.recommendation, l.discipline].join(' '), terms) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.l);
  }

  res.json({
    categories: CATEGORIES,
    total: store.readAll(COLLECTION).length,
    count: items.length,
    lessons: items,
  });
});

// ── POST /api/lessons ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { observation, category, system, project, severity, recommendation, source, discipline } = req.body;
    if (!observation || !observation.trim()) return res.status(400).json({ error: 'observation is required' });
    const item = store.insert(COLLECTION, {
      observation: observation.trim(),
      category: CATEGORIES.includes(category) ? category : (category || 'Documentation'),
      system: system || '',
      project: project || '',
      severity: severity || 'medium',
      recommendation: recommendation || '',
      discipline: discipline || '',
      source: source || 'manual',
      addedBy: req.user?.username || 'unknown',
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/lessons/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const all = store.readAll(COLLECTION);
  const target = all.find(l => l.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Lesson not found' });
  if (req.user?.role !== 'admin' && target.addedBy !== req.user?.username) {
    return res.status(403).json({ error: 'You can only delete lessons you added.' });
  }
  store.remove(COLLECTION, req.params.id);
  res.json({ ok: true, id: req.params.id });
});

// ── POST /api/lessons/suggest  (proactive surfacing) ─────────────────────────
router.post('/suggest', async (req, res) => {
  try {
    const { system = '', domain = '', query = '' } = req.body;
    const focus = [system, domain, query].filter(Boolean).join(' ') || 'ship design';

    // 1) Retrieve the most relevant stored lessons (keyword overlap)
    const terms = focus.toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = store.readAll(COLLECTION)
      .map(l => ({ l, s: tokenScore([l.observation, l.system, l.project, l.category, l.recommendation, l.discipline].join(' '), terms) }))
      .sort((a, b) => b.s - a.s);
    const relevant = (ranked.filter(x => x.s > 0).slice(0, 12).map(x => x.l));
    const pool = relevant.length ? relevant : store.readAll(COLLECTION).slice(0, 12);

    // 2) Detect recurring issues (same category/observation theme repeated)
    const freq = {};
    for (const l of store.readAll(COLLECTION)) {
      const key = `${l.category}`;
      freq[key] = (freq[key] || 0) + 1;
    }

    // 3) Ground recommendations in classification rules too
    const { block: ruleBlock, citations } = await ragContextBlock(focus, 6, { domain: domain || undefined });

    const lessonsBlock = pool.length
      ? pool.map((l, i) => `[${i + 1}] (${l.category}${l.system ? ' · ' + l.system : ''}${l.project ? ' · ' + l.project : ''}) ${l.observation}${l.recommendation ? ` → Recommendation: ${l.recommendation}` : ''}`).join('\n')
      : '(No historical lessons captured yet.)';

    const prompt = `A ship designer is working on / querying: "${focus}".
Proactively brief them using the historical Lessons-Learned below and the applicable rule context.

HISTORICAL LESSONS (from past project inspection reports):
${lessonsBlock}

APPLICABLE RULE CONTEXT:
${ruleBlock || '(none retrieved)'}

Return JSON:
{
  "relevantLessons":      [ { "observation": "", "category": "", "whyItMatters": "" } ],
  "recurringIssues":      [ { "issue": "", "frequency": "", "category": "" } ],
  "designConsiderations": [ { "recommendation": "", "rationale": "", "reference": "" } ],
  "summary": ""
}
- relevantLessons: the 3-6 most relevant past observations for this system.
- recurringIssues: defects that recur across projects (note how often).
- designConsiderations: concrete, actionable design recommendations to avoid repeating these defects; cite a rule clause in "reference" where applicable.
Output ONLY the JSON.`;

    const out = await generateJSON(prompt, { maxOutputTokens: 6000, temperature: 0.3 });
    res.json({
      focus,
      citations,
      lessonsConsidered: pool.length,
      categoryFrequency: freq,
      ...out,
    });
  } catch (err) {
    console.error('[/api/lessons/suggest]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, CATEGORIES, COLLECTION };
