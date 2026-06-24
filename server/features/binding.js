'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Binding Data Review
// Reviews vendor binding data / technical submissions against the Purchase
// Order Technical Specification (POTS). Identifies missing information,
// drawings, calculations, certificates, manuals, test procedures and
// compliance documents; produces a gap-analysis report and recommends the
// specific points designers should seek before approving the binding data.
//   - POST /api/binding/gap   { potsId|potsText, bindingId|bindingText, system }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { generateJSON } = require('../lib/llm');
const { resolveDocText, mapLimit, ragContextBlock } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');

const router = express.Router();

const SYSTEM = `You are a design-review engineer at a shipyard reviewing a vendor's binding data (final technical submission) against the Purchase Order Technical Specification (POTS) before approval.
You know exactly what a complete binding-data package must contain: GA & detail drawings, design calculations, material certificates, type/test certificates, O&M manuals, test & commissioning procedures, ITP, data sheets, compliance/class certificates, spares & tools lists, interface details, weights & coordinates.
You meticulously flag anything missing, partial, or insufficient for approval.`;

const ITEM_TYPES = ['Drawing', 'Calculation', 'Certificate', 'Manual', 'Test Procedure', 'Data Sheet', 'Compliance Document', 'Information'];
const STATUSES   = ['Submitted', 'Partial', 'Insufficient', 'Missing'];

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

async function assessWindow(potsChunk, bindingText, system) {
  const prompt = `From this section of the Purchase Order Technical Specification (POTS), derive every deliverable / data item the vendor is required to submit as binding data, then check whether the vendor's binding-data submission contains it and is adequate.
System: ${system || '(unspecified)'}

POTS SECTION:
${potsChunk}

VENDOR BINDING DATA SUBMISSION (search this for each required item):
${bindingText.slice(0, 90000)}

Return JSON: { "gaps": [ {
  "item":          "",  // the required deliverable / information item
  "itemType":      ${JSON.stringify(ITEM_TYPES)},
  "potsRef":       "",  // POTS clause/para reference if shown
  "status":        ${JSON.stringify(STATUSES)},
  "finding":       "",  // what is present / what is missing or inadequate
  "actionRequired":""   // the specific point to seek from the vendor before approval
} ] }

Rules:
- One row per required deliverable.
- "Submitted" only if present AND adequate; "Partial" if present but incomplete; "Insufficient" if present but not to spec; "Missing" if absent.
- Do not invent submissions. If the binding data is silent on an item, mark "Missing".
Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('binding'), maxOutputTokens: 16384, temperature: 0.15 });
  return Array.isArray(out.gaps) ? out.gaps : [];
}

async function buildRecommendations(gaps, system, ruleBlock) {
  const open = gaps.filter(g => g.status !== 'Submitted').slice(0, 80);
  const compact = open.map(g => `- [${g.status}] (${g.itemType}) ${g.item}${g.potsRef ? ` [${g.potsRef}]` : ''}`).join('\n');
  const prompt = `Based on the open gaps below from a vendor binding-data review for "${system || 'the system'}", and the applicable rules, list the specific points the designers should formally seek from the vendor before approving the binding data.

OPEN GAPS:
${compact || '(none open)'}

APPLICABLE RULES:
${ruleBlock || '(none)'}

Return JSON: { "recommendations": [ { "point": "", "category": "Drawing"|"Calculation"|"Certificate"|"Manual"|"Test Procedure"|"Data Sheet"|"Compliance Document"|"Information", "priority": "high"|"medium"|"low", "rationale": "" } ] }
Generate concise, actionable points (8-20). Output ONLY the JSON.`;
  const out = await generateJSON(prompt, { system: SYSTEM, maxOutputTokens: 8192, temperature: 0.3 });
  return Array.isArray(out.recommendations) ? out.recommendations : [];
}

router.post('/gap', async (req, res) => {
  try {
    const system = req.body.system || '';
    const pots    = resolveDocText({ id: req.body.potsId,    text: req.body.potsText,    name: req.body.potsName },    'POTS');
    const binding = resolveDocText({ id: req.body.bindingId, text: req.body.bindingText, name: req.body.bindingName }, 'binding data');

    const potsWindows = windows(pots.text);
    const errors = [];
    const all = await mapLimit(potsWindows, 2, async (w) => {
      try { return await assessWindow(w, binding.text, system); }
      catch (e) { errors.push(e.message); return []; }
    });
    let gaps = all.flat().filter(g => g && (g.item || g.potsRef));
    if (!gaps.length && errors.length) {
      return res.status(502).json({ error: `AI gap analysis failed: ${errors[0]}` });
    }
    gaps = gaps.map((g, i) => ({
      slNo: i + 1,
      ...g,
      itemType: ITEM_TYPES.includes(g.itemType) ? g.itemType : 'Information',
      status: STATUSES.includes(g.status) ? g.status : 'Missing',
    }));

    const stats = {};
    for (const s of STATUSES) stats[s] = gaps.filter(g => g.status === s).length;
    const completeness = gaps.length
      ? Math.round((100 * (stats['Submitted'] + 0.5 * stats['Partial'])) / gaps.length)
      : 0;

    const { block: ruleBlock, citations } = await ragContextBlock(`${system} binding data drawings calculations certificates manuals test procedures`, 5);
    const recommendations = (await buildRecommendations(gaps, system, ruleBlock).catch(() => []))
      .map((r, i) => ({ slNo: i + 1, ...r }));

    res.json({
      system,
      pots: pots.name,
      binding: binding.name,
      itemTypes: ITEM_TYPES,
      statuses: STATUSES,
      stats,
      completeness,
      total: gaps.length,
      gaps,
      recommendations,
      citations,
    });
  } catch (err) {
    console.error('[/api/binding/gap]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
