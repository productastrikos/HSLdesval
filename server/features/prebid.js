'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-Bid Query Generation
// Analyses RFP documents, specifications, standards and contractual
// requirements, uses historical lessons + applicable rules, and automatically
// generates technically relevant pre-bid queries — identifying ambiguities,
// contradictions, missing information, impractical requirements and execution
// risks within the RFP.
//   - POST /api/prebid/queries   { rfpId|rfpText, focus }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { generateJSON } = require('../lib/llm');
const { resolveDocText, mapLimit, ragContextBlock } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
const store = require('../lib/store');

const router = express.Router();

const SYSTEM = `You are a bid/proposal engineer at a shipyard preparing pre-bid queries for an RFP/tender.
You read RFPs, technical specifications, scope of work, standards and contractual terms with a critical eye, surfacing every ambiguity, contradiction, missing piece of information, technically impractical requirement, and execution/commercial risk that should be clarified BEFORE bidding.
Your queries are specific, reference the clause, and are phrased so the client can answer them directly.`;

const CATEGORIES = ['Ambiguity', 'Contradiction', 'Missing Information', 'Impractical Requirement', 'Execution Risk', 'Scope/Interface', 'Commercial-Contractual', 'Clarification'];

function windows(text, size = 12000) {
  const paras = (text || '').split(/\n{2,}/);
  const out = []; let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

async function queriesForWindow(chunk, focus, lessonsBlock, ruleBlock) {
  const prompt = `Analyse this section of an RFP / tender and generate pre-bid queries.
${focus ? `Bid focus: ${focus}` : ''}

RFP SECTION:
${chunk}

PAST PROJECT LESSONS / PRIOR BID CLARIFICATIONS:
${lessonsBlock || '(none)'}

APPLICABLE RULES / STANDARDS:
${ruleBlock || '(none)'}

Return JSON: { "queries": [ {
  "clauseRef":         "",  // clause / section / drawing reference in the RFP
  "pageNumber":        "",  // page number from the nearest "----- Page N -----" marker preceding the clause
  "clauseDescription": "",  // a concise description/quote of what the referenced clause says
  "category":          ${JSON.stringify(CATEGORIES)},
  "query":             "",  // the question to raise with the client, specific and answerable
  "rationale":         "",  // why it matters (the ambiguity/contradiction/risk it addresses)
  "risk":              "high" | "medium" | "low"
} ] }

Rules:
- Only raise queries grounded in THIS section's text. Reference the clause AND its page number (read the "----- Page N -----" markers).
- "clauseDescription" must summarise the actual clause text the query is about.
- Prefer concrete, technical queries over generic ones. Flag contradictions against other clauses you can see.
- If the section is purely boilerplate with nothing to query, return { "queries": [] }.
Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('prebid'), maxOutputTokens: 12000, temperature: 0.35 });
  return Array.isArray(out.queries) ? out.queries : [];
}

router.post('/queries', async (req, res) => {
  try {
    const focus = req.body.focus || '';
    const rfp = resolveDocText({ id: req.body.rfpId, text: req.body.rfpText, name: req.body.rfpName }, 'RFP');

    const terms = (focus || rfp.name).toLowerCase().split(/\s+/).filter(Boolean);
    const lessonsBlock = store.readAll('lessons')
      .filter(l => terms.some(t => `${l.system} ${l.observation} ${l.project} ${l.category}`.toLowerCase().includes(t)))
      .slice(0, 8)
      .map(l => `- (${l.category}) ${l.observation}`).join('\n');
    const { block: ruleBlock, citations } = await ragContextBlock(`${focus} ${rfp.name} requirements standards`, 6);

    const chunks = windows(rfp.text);
    const errors = [];
    const all = await mapLimit(chunks, 2, async (c) => {
      try { return await queriesForWindow(c, focus, lessonsBlock, ruleBlock); }
      catch (e) { errors.push(e.message); return []; }
    });
    let queries = all.flat().filter(q => q && q.query);
    if (!queries.length && errors.length) {
      return res.status(502).json({ error: `AI query generation failed: ${errors[0]}` });
    }

    // Light dedupe by query text
    const seen = new Set();
    queries = queries.filter(q => {
      const k = q.query.trim().toLowerCase().slice(0, 80);
      if (seen.has(k)) return false; seen.add(k); return true;
    }).map((q, i) => ({
      slNo: i + 1,
      ...q,
      category: CATEGORIES.includes(q.category) ? q.category : 'Clarification',
    }));

    const byCategory = {};
    for (const c of CATEGORIES) byCategory[c] = queries.filter(q => q.category === c).length;

    res.json({
      rfp: rfp.name,
      focus,
      categories: CATEGORIES,
      byCategory,
      total: queries.length,
      queries,
      citations,
    });
  } catch (err) {
    console.error('[/api/prebid/queries]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
