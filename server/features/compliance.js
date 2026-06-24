'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Technical Offer Scrutiny & Compliance Assessment
// Reviews one OR MORE vendor technical offers against the Tender Technical
// Specification (TTS / SOTR): clause-by-clause Technical Compliance Matrix,
// deviations / exclusions / assumptions / ambiguities / non-compliances, vendor
// technical queries, and EXPLICIT recommendations (e.g. "Seek this document from
// the vendor") for the Excel output.
//   - POST /api/compliance/matrix   { ttsId|ttsText, offers:[{name,text}] | offerId|offerText, system }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { generateJSON } = require('../lib/llm');
const { resolveDocText, mapLimit, ragContextBlock } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
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
- "Complied" only when the offer clearly meets it; "Partially Complied" if partially; "Deviation" if the offer differs; "Exclusion" if explicitly excluded; "Not Addressed" if silent; "Ambiguous" if unclear.
- Do not invent offer content. If silent, say so and mark "Not Addressed".
Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('compliance'), maxOutputTokens: 16384, temperature: 0.15 });
  return Array.isArray(out.matrix) ? out.matrix : [];
}

async function buildQueries(matrix, system, lessonsBlock, ruleBlock) {
  const flagged = matrix.filter(m => m.status !== 'Complied').slice(0, 80);
  const compact = flagged.map(m => `- [${m.status}] ${m.clauseRef}: ${m.requirement}${m.deviation ? ` (${m.deviation})` : ''}`).join('\n');
  const prompt = `Based on the non-compliant / deviating / ambiguous items below (from a vendor technical-offer evaluation for "${system || 'the system'}"), past procurement experience and applicable rules, generate the technical queries and evaluation questions to raise with the vendor.

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

async function buildRecommendations(matrix, system) {
  const flagged = matrix.filter(m => m.status !== 'Complied').slice(0, 80);
  const compact = flagged.map(m => `- [${m.status}] ${m.clauseRef}: ${m.requirement}${m.deviation ? ` (${m.deviation})` : ''}`).join('\n');
  const prompt = `You are finalising the evaluation of a vendor technical offer for "${system || 'the system'}". For each gap below, give the evaluator an EXPLICIT, actionable recommendation. Phrase document gaps as "Seek <the specific document/datasheet/certificate/clarification> from the vendor".

GAPS / FLAGGED ITEMS:
${compact || '(offer appears largely compliant — still recommend the standard documents to seek before award)'}

Return JSON: { "recommendations": [ {
  "clauseRef":      "",
  "recommendation": "",   // e.g. "Seek the type-test certificate for the gyro unit from the vendor"
  "action":         "Seek Document" | "Seek Clarification" | "Reject/Deviation" | "Accept with Condition" | "Negotiate",
  "priority":       "high" | "medium" | "low"
} ] }
Generate concise, decision-ready recommendations (6-20). Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM, maxOutputTokens: 8192, temperature: 0.3 });
  return Array.isArray(out.recommendations) ? out.recommendations : [];
}

async function evaluateOffer(offer, ttsWindows, system, lessonsBlock, ruleBlock) {
  const errors = [];
  const matrices = await mapLimit(ttsWindows, 2, async (w) => {
    try { return await assessWindow(w, offer.text, system); }
    catch (e) { errors.push(e.message); return []; }
  });
  let matrix = matrices.flat().filter(m => m && (m.requirement || m.clauseRef));
  if (!matrix.length && errors.length) throw new Error(errors[0]);
  matrix = matrix.map((m, i) => ({ slNo: i + 1, ...m, status: STATUSES.includes(m.status) ? m.status : 'Ambiguous' }));

  const stats = {};
  for (const s of STATUSES) stats[s] = matrix.filter(m => m.status === s).length;
  const compliancePct = matrix.length
    ? Math.round((100 * (stats['Complied'] + 0.5 * stats['Partially Complied'])) / matrix.length) : 0;

  const [queries, recommendations] = await Promise.all([
    buildQueries(matrix, system, lessonsBlock, ruleBlock).catch(() => []),
    buildRecommendations(matrix, system).catch(() => []),
  ]);

  return {
    offer: offer.name, total: matrix.length, stats, compliancePct, matrix,
    queries: queries.map((q, i) => ({ slNo: i + 1, ...q })),
    recommendations: recommendations.map((r, i) => ({ slNo: i + 1, ...r })),
  };
}

router.post('/matrix', async (req, res) => {
  try {
    const system = req.body.system || '';
    const tts = resolveDocText({ id: req.body.ttsId, text: req.body.ttsText, name: req.body.ttsName }, 'TTS / SOTR');

    // Accept multiple offers (offers:[{name,text}]) or a single offer (back-compat).
    let offers = [];
    if (Array.isArray(req.body.offers) && req.body.offers.length) {
      offers = req.body.offers.filter(o => o && o.text && o.text.trim()).map(o => ({ name: o.name || 'offer', text: o.text }));
    } else {
      offers = [resolveDocText({ id: req.body.offerId, text: req.body.offerText, name: req.body.offerName }, 'technical offer')];
    }
    if (!offers.length) return res.status(400).json({ error: 'Provide at least one vendor technical offer.' });
    offers = offers.slice(0, 5);   // bound cost

    const ttsWindows = windows(tts.text);
    const terms = (system || tts.name).toLowerCase().split(/\s+/).filter(Boolean);
    const lessons = store.readAll('lessons')
      .filter(l => terms.some(t => `${l.system} ${l.observation} ${l.project}`.toLowerCase().includes(t)))
      .slice(0, 8).map(l => `- (${l.category}) ${l.observation}`).join('\n');
    const { block: ruleBlock, citations } = await ragContextBlock(`${system} technical specification compliance`, 5);

    const results = [];
    const errs = [];
    for (const offer of offers) {
      try { results.push(await evaluateOffer(offer, ttsWindows, system, lessons, ruleBlock)); }
      catch (e) { errs.push(`${offer.name}: ${e.message}`); }
    }
    if (!results.length) return res.status(502).json({ error: `AI assessment failed: ${errs[0] || 'no result'}` });

    res.json({ system, tts: tts.name, statuses: STATUSES, offerCount: results.length, results, citations });
  } catch (err) {
    console.error('[/api/compliance/matrix]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
