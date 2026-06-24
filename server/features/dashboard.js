'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-driven Analytics Dashboard
// Nothing is pre-populated. The user asks a question and selects documents; the
// AI returns equipment-wise analytics (KPIs + charts + a table) computed strictly
// from those documents / that prompt.
//   - POST /api/dashboard/analytics  { prompt, sources:[{name,text}] }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { generateJSON } = require('../lib/llm');
const { getFeedbackGuidance } = require('./feedback');

const router = express.Router();

const SYSTEM = `You are a marine-engineering data analyst building an analytics dashboard for a shipyard.
You read the supplied documents and answer the user's analytics question with concrete numbers, grouped equipment-wise where relevant.
You ONLY use facts present in the documents (or the user's explicit instruction). You never invent data; if the documents don't support a number, omit it.`;

router.post('/analytics', async (req, res) => {
  try {
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Enter what you want the dashboard to show.' });
    const sources = Array.isArray(req.body.sources) ? req.body.sources.filter(s => s && s.text) : [];

    const corpus = sources.length
      ? sources.map(s => `##### ${s.name} #####\n${(s.text || '').slice(0, 18000)}`).join('\n\n')
      : '(No documents selected — answer only if the request is self-contained; otherwise return empty analytics with a note in summary.)';

    const full = `User analytics request: ${prompt}

DOCUMENTS:
${corpus}

Build the dashboard. Return ONLY JSON:
{
  "summary": "",                         // 1-3 sentence headline answer
  "kpis":    [ { "label": "", "value": "", "unit": "", "tone": "sky|emerald|amber|red|violet" } ],
  "charts":  [ { "title": "", "type": "bar", "data": [ { "label": "", "value": 0 } ] } ],
  "table":   { "columns": [ "" ], "rows": [ { } ] }   // equipment-wise rows when relevant; [] if N/A
}
- Make at least one chart equipment-wise when the request involves equipment/systems.
- Keep numbers grounded in the documents. If nothing is found, return empty arrays and explain in "summary".
Output ONLY the JSON.`;

    const out = await generateJSON(full, { system: SYSTEM + getFeedbackGuidance('dashboard'), temperature: 0.2, maxOutputTokens: 8000 });
    res.json({
      summary: out.summary || '',
      kpis:    Array.isArray(out.kpis)   ? out.kpis   : [],
      charts:  Array.isArray(out.charts) ? out.charts : [],
      table:   (out.table && Array.isArray(out.table.columns)) ? out.table : { columns: [], rows: [] },
      sources: sources.map(s => s.name),
    });
  } catch (err) {
    console.error('[/api/dashboard/analytics]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
