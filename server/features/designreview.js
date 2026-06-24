'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Design Review & Risk Assessment Support
// Generates system-wise design-review checklists, identifies potential design
// risks from historical project data, highlights recurring deficiencies and
// recommends preventive measures.
//   - POST /api/designreview/checklist   { system, domain, scope }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { generateJSON } = require('../lib/llm');
const { resolveDocText, ragContextBlock, resolveSystemName, systemSimilarity, normalizeSystem } = require('./_util');
const { getFeedbackGuidance } = require('./feedback');
const store = require('../lib/store');

const router = express.Router();

const SYSTEM = `You are a chief design-review engineer at a shipyard chairing a system design review.
You produce thorough, system-specific design-review checklists tied to class rules, statutory regs and standards, and a risk register informed by what has actually gone wrong on past projects.
You prioritise recurring deficiencies and give concrete preventive measures.`;

router.post('/checklist', async (req, res) => {
  try {
    const system = (req.body.system || '').trim();
    const domain = req.body.domain || '';
    const scope  = req.body.scope || '';
    if (!system) return res.status(400).json({ error: 'system is required (e.g. "MB/SRE system", "Steering gear", "Main switchboard").' });

    // Optional design document context
    let docBlock = '';
    if (req.body.docId || req.body.docText) {
      try {
        const d = resolveDocText({ id: req.body.docId, text: req.body.docText, name: req.body.docName }, 'design document');
        docBlock = `\nDESIGN DOCUMENT UNDER REVIEW (${d.name}):\n${d.text.slice(0, 18000)}\n`;
      } catch (_) { /* optional */ }
    }

    // Resolve a possibly slightly-off system name against the systems we actually
    // have history for, so a typo/abbreviation ("steerring gear" → "Steering gear")
    // still grounds the review in the right lessons instead of silently finding none.
    const allLessons = store.readAll('lessons');
    const knownSystems = [...new Set(allLessons.map(l => l.system).filter(Boolean))];
    const sys = resolveSystemName(system, knownSystems);
    const effectiveSystem = sys.resolved;   // a known system when confident, else as typed

    // Historical lessons for this system → recurring deficiencies. Matched fuzzily:
    // a lesson whose system is ~the same scores strongly even with a typo, plus any
    // domain/scope term hits in the lesson text.
    const extraTerms = [...new Set(normalizeSystem(`${effectiveSystem} ${domain} ${scope}`).split(' '))].filter(t => t.length > 2);
    const lessons = allLessons
      .map(l => {
        let s = systemSimilarity(l.system, effectiveSystem) >= 0.6 ? 3 : 0;
        const hay = normalizeSystem(`${l.system} ${l.observation} ${l.category} ${l.project}`);
        for (const t of extraTerms) if (hay.includes(t)) s += 1;
        return { l, s };
      })
      .sort((a, b) => b.s - a.s)
      .filter(x => x.s > 0)
      .slice(0, 15)
      .map(x => x.l);

    // Recurrence tally by observation theme
    const recur = {};
    for (const l of allLessons) {
      const key = (l.observation || '').toLowerCase().slice(0, 40);
      if (!key) continue;
      recur[key] = recur[key] || { count: 0, sample: l.observation, category: l.category };
      recur[key].count++;
    }
    const recurring = Object.values(recur).filter(r => r.count > 1).sort((a, b) => b.count - a.count).slice(0, 10);

    const lessonsBlock = lessons.length
      ? lessons.map((l, i) => `[${i + 1}] (${l.category}${l.system ? ' · ' + l.system : ''}${l.project ? ' · ' + l.project : ''}) ${l.observation}${l.recommendation ? ` → ${l.recommendation}` : ''}`).join('\n')
      : '(No historical lessons captured for this system yet.)';
    const recurringBlock = recurring.length
      ? recurring.map(r => `- ${r.sample} (seen ${r.count}× · ${r.category})`).join('\n')
      : '(No recurring deficiencies detected yet.)';

    const { block: ruleBlock, citations } = await ragContextBlock(`${effectiveSystem} ${domain} design review requirements`, 8, { domain: domain || undefined });

    const systemForPrompt = sys.matched
      ? `"${system}" (interpreted as the standard system "${effectiveSystem}")`
      : `"${system}"`;

    const prompt = `Prepare a system design review for: ${systemForPrompt}${domain ? ` (domain: ${domain})` : ''}${scope ? `\nReview scope/notes: ${scope}` : ''}.
The system name may contain a typo, abbreviation or shipyard shorthand — interpret it as the closest standard marine/ship system and proceed; never refuse or ask for clarification.
${docBlock}
APPLICABLE RULES / STANDARDS:
${ruleBlock || '(none retrieved)'}

HISTORICAL LESSONS (past inspection reports for similar systems):
${lessonsBlock}

RECURRING DEFICIENCIES:
${recurringBlock}

Return JSON:
{
  "checklist": [ {
    "area":      "",  // review area (e.g. "Cable routing & segregation", "Earthing", "Structural fire protection")
    "checkItem": "",  // the specific thing to verify, phrased as a check
    "reference": "",  // rule/standard clause or "Lessons-learned" / "Best practice"
    "basis":     "Rule" | "Lesson" | "Best Practice"
  } ],
  "risks": [ {
    "risk":             "",
    "category":         "",  // Material/Design/Workmanship/Installation/Documentation/Testing or a discipline
    "likelihood":       "high" | "medium" | "low",
    "impact":           "high" | "medium" | "low",
    "recurring":        "yes" | "no",
    "preventiveMeasure":"",
    "reference":        ""
  } ]
}
- Make the checklist genuinely specific to "${effectiveSystem}" (15-30 items across multiple areas), not generic.
- Derive risks especially from the historical lessons and recurring deficiencies; mark "recurring":"yes" for those.
Output ONLY the JSON.`;

    const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('designreview'), maxOutputTokens: 20000, temperature: 0.3 });
    const checklist = (Array.isArray(out.checklist) ? out.checklist : []).map((c, i) => ({ slNo: i + 1, ...c }));
    const risks     = (Array.isArray(out.risks) ? out.risks : []).map((r, i) => ({ slNo: i + 1, ...r }));

    res.json({
      system,
      resolvedSystem:    effectiveSystem,
      systemInterpreted: sys.matched,        // true when the typed name was corrected to a known system
      domain, scope,
      checklist,
      risks,
      checklistCount: checklist.length,
      riskCount: risks.length,
      lessonsUsed: lessons.length,
      recurringCount: recurring.length,
      citations,
    });
  } catch (err) {
    console.error('[/api/designreview/checklist]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
