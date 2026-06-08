'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Technical Offer Scrutiny & Compliance Assessment
// Reviews a vendor technical offer against the Tender Technical Specification
// (TTS / SOTR), preparing a Technical Compliance Matrix, identifying
// deviations / exclusions / assumptions / ambiguities / non-compliances, and
// generating technical queries / evaluation questions for the vendor.
//   - POST /api/compliance/matrix   { ttsId|ttsText, offerId|offerText, system }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { generateJSON } = require('../lib/llm');
const { resolveDocText, mapLimit, ragContextBlock } = require('./_util');
const store = require('../lib/store');

const router = express.Router();

const SYSTEM = `You are a technical evaluation engineer at a shipyard scrutinising vendor technical offers against the Tender Technical Specification (TTS / SOTR).
You build clause-by-clause Technical Compliance Matrices, and you are rigorous about distinguishing genuine compliance from vague claims, partial compliance, deviations, exclusions, assumptions and silent non-compliance.
You never mark something "Complied" unless the offer substantiates it.`;

const STATUSES = ['Complied', 'Partially Complied', 'Deviation', 'Exclusion', 'Not Addressed', 'Ambiguous'];

function windows(text, size = 11000) {
  const paras = (text || '').split(/\n{2,}/);
  const out = []; let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

async function assessWindow(ttsChunk, offerText, system) {
  const prompt = `Assess the vendor's technical offer against this section of the Tender Technical Specification (TTS).
System: ${system || '(unspecified)'}

TTS SECTION (extract each distinct requirement):
${ttsChunk}

VENDOR TECHNICAL OFFER (search this for the vendor's response to each requirement):
${offerText.slice(0, 90000)}

Return JSON: { "matrix": [ {
  "clauseRef":     "",  // TTS clause/para number or short requirement id
  "requirement":   "",  // the TTS requirement, concisely
  "offerResponse": "",  // what the offer actually says (quote/paraphrase), or "Not addressed in offer"
  "status":        ${JSON.stringify(STATUSES)},
  "deviation":     "",  // describe any deviation/exclusion/assumption/ambiguity, else ""
  "remarks":       ""   // evaluator remark
} ] }

Rules:
- One row per distinct TTS requirement in this section.
- "Complied" only when the offer clearly meets it; "Partially Complied" if partially; "Deviation" if the offer differs; "Exclusion" if the vendor explicitly excludes it; "Not Addressed" if the offer is silent; "Ambiguous" if unclear.
- Do not invent offer content. If silent, say so and mark "Not Addressed".
Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM, maxOutputTokens: 16384, temperature: 0.15 });
  return Array.isArray(out.matrix) ? out.matrix : [];
}

async function buildQueries(matrix, system, lessonsBlock, ruleBlock) {
  const flagged = matrix.filter(m => m.status !== 'Complied').slice(0, 80);
  const compact = flagged.map(m => `- [${m.status}] ${m.clauseRef}: ${m.requirement}${m.deviation ? ` (${m.deviation})` : ''}`).join('\n');
  const prompt = `Based on the non-compliant / deviating / ambiguous items below (from a vendor technical-offer evaluation for "${system || 'the system'}"), and on past procurement experience and applicable rules, generate the technical queries and evaluation questions to raise with the vendor.

FLAGGED ITEMS:
${compact || '(none flagged — still generate prudent clarification questions based on the TTS scope)'}

PAST PROCUREMENT LESSONS:
${lessonsBlock || '(none)'}

APPLICABLE RULES:
${ruleBlock || '(none)'}

Return JSON: { "queries": [ {
  "clauseRef": "", "query": "", "category": "Deviation" | "Exclusion" | "Assumption" | "Ambiguity" | "Non-Compliance" | "Clarification" | "Commercial-Technical",
  "rationale": ""
} ] }
Generate 8-20 sharp, specific queries. Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM, maxOutputTokens: 8192, temperature: 0.3 });
  return Array.isArray(out.queries) ? out.queries : [];
}

router.post('/matrix', async (req, res) => {
  try {
    const system = req.body.system || '';
    const tts   = resolveDocText({ id: req.body.ttsId,   text: req.body.ttsText,   name: req.body.ttsName },   'TTS / SOTR');
    const offer = resolveDocText({ id: req.body.offerId, text: req.body.offerText, name: req.body.offerName }, 'technical offer');

    const ttsWindows = windows(tts.text);
    const errors = [];
    const matrices = await mapLimit(ttsWindows, 2, async (w) => {
      try { return await assessWindow(w, offer.text, system); }
      catch (e) { errors.push(e.message); return []; }
    });
    let matrix = matrices.flat().filter(m => m && (m.requirement || m.clauseRef));
    if (!matrix.length && errors.length) {
      return res.status(502).json({ error: `AI assessment failed: ${errors[0]}` });
    }
    matrix = matrix.map((m, i) => ({
      slNo: i + 1,
      ...m,
      status: STATUSES.includes(m.status) ? m.status : 'Ambiguous',
    }));

    // Stats
    const stats = {};
    for (const s of STATUSES) stats[s] = matrix.filter(m => m.status === s).length;
    const compliancePct = matrix.length
      ? Math.round((100 * (stats['Complied'] + 0.5 * stats['Partially Complied'])) / matrix.length)
      : 0;

    // Ground queries in lessons + rules
    const terms = (system || tts.name).toLowerCase().split(/\s+/).filter(Boolean);
    const lessons = store.readAll('lessons')
      .filter(l => terms.some(t => `${l.system} ${l.observation} ${l.project}`.toLowerCase().includes(t)))
      .slice(0, 8)
      .map(l => `- (${l.category}) ${l.observation}`).join('\n');
    const { block: ruleBlock, citations } = await ragContextBlock(`${system} technical specification compliance`, 5);

    const queries = (await buildQueries(matrix, system, lessons, ruleBlock).catch(() => []))
      .map((q, i) => ({ slNo: i + 1, ...q }));

    res.json({
      system,
      tts: tts.name,
      offer: offer.name,
      statuses: STATUSES,
      stats,
      compliancePct,
      total: matrix.length,
      matrix,
      queries,
      citations,
    });
  } catch (err) {
    console.error('[/api/compliance/matrix]', err.message);
    res.status(err.message.includes('No ') ? 400 : 500).json({ error: err.message });
  }
});

module.exports = router;
