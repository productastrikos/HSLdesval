'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Automatic document-type classification (shared)
// The upload page never asks the user what kind of document they are uploading;
// we infer it from the content. Heuristics first (fast, deterministic), with an
// inference fallback for anything ambiguous. Used by both the single-document
// upload endpoint and the persistent shared repository.
// ─────────────────────────────────────────────────────────────────────────────

const { generateText } = require('./llm');

const DOC_TYPES = [
  'SOTR', 'POTS', 'Technical Offer', 'Binding Data', 'Compliance Matrix',
  'Inspection Report', 'Drawing', 'Build Specification', 'RFP / Tender', 'General Document',
];

// Weighted signals per category. Strong, specific phrases score high; generic
// single words score low (so an incidental mention doesn't force a label).
// A signal that appears in the FILENAME counts double — filenames are the most
// reliable indicator (e.g. "EED-56-02 SOTR DGPS.pdf", "11190-91_POTS_SPT.pdf").
const DOCTYPE_SIGNALS = [
  ['POTS',                [[/\bpots\b/, 5], [/purchase order technical spec/, 5]]],
  ['SOTR',                [[/\bsotr\b/, 5], [/statement of technical requirement/, 5], [/schedule of technical requirement/, 5], [/tender technical specification/, 4], [/\btts\b/, 3], [/technical requirements for\b/, 2]]],
  ['Compliance Matrix',   [[/compliance matrix/, 5], [/technical[_ ]compliance/, 4], [/compliance statement/, 4], [/deviation statement/, 4], [/comply\s*\/\s*not[\s-]?comply/, 5], [/\(\s*comply\b/, 3], [/clause[- ]?by[- ]?clause/, 3]]],
  ['Technical Offer',     [[/technical offer/, 5], [/technical bid/, 4], [/vendor offer/, 4], [/bid offer/, 4], [/budgetary (quotation|offer|quote)/, 3], [/\bquotation\b/, 1]]],
  ['Binding Data',        [[/binding data/, 5], [/\bbdd\b/, 4], [/guaranteed (technical )?(data|particulars)/, 4], [/technical particulars/, 2], [/\bdata[\s_]?sheet\b/, 2]]],
  ['Inspection Report',   [[/inspection report/, 5], [/non[- ]?conformit/, 3], [/\bncr\b/, 3], [/(harbour|sea) acceptance trial/, 4], [/trial report/, 3], [/snag list/, 3], [/punch list/, 3], [/\bobservation/, 1]]],
  ['Drawing',             [[/single line diagram/, 5], [/\bsld\b/, 4], [/cable schedule/, 4], [/general arrangement/, 4], [/\bp&id\b/, 4], [/interconnection diagram/, 4], [/\bga plan\b/, 3], [/drawing no\.?|drg\.? no\.?/, 2]]],
  ['Build Specification', [[/build(ing)? specification/, 5], [/build spec\b/, 4]]],
  ['RFP / Tender',        [[/request for proposal/, 5], [/invitation to bid/, 4], [/\brfp\b/, 4], [/tender enquiry/, 4], [/\bnit\b/, 3], [/\btender\b/, 2]]],
];

function heuristicDocType(text, name = '') {
  const rawName = (name || '').toLowerCase();

  // File extension is the strongest possible signal for CAD drawings.
  if (/\.(dwg|dxf)$/i.test(rawName)) return 'Drawing';

  // Normalise separators → spaces so \b word boundaries work. Underscores and
  // dots are WORD characters in regex, so "_POTS_" / "SOTR_HDCS" would otherwise
  // never match \bpots\b / \bsotr\b — the main cause of misclassified uploads.
  const fname = rawName.replace(/[_\-./\\]+/g, ' ');
  const body  = (text || '').slice(0, 6000).toLowerCase().replace(/_+/g, ' ');

  let best = null, bestScore = 0;
  for (const [type, pats] of DOCTYPE_SIGNALS) {
    let score = 0;
    for (const [re, w] of pats) {
      if (re.test(fname))      score += w * 2;   // filename match — most reliable
      else if (re.test(body))  score += w;
    }
    if (score > bestScore) { bestScore = score; best = type; }
  }
  // Only trust the heuristic when reasonably confident; otherwise defer to the LLM.
  return bestScore >= 4 ? best : null;
}

// One-line descriptions to ground the LLM classifier when heuristics are unsure.
const DOC_TYPE_HINTS = {
  'SOTR': 'Statement of Technical Requirements / Tender Technical Specification — what the buyer requires.',
  'POTS': 'Purchase Order Technical Specification — technical terms attached to a purchase order.',
  'Technical Offer': "A vendor's technical proposal / bid / quotation in response to an enquiry.",
  'Binding Data': 'Vendor binding data — guaranteed particulars, datasheets, certificates, manuals submitted for approval.',
  'Compliance Matrix': 'A clause-by-clause compliance / deviation statement comparing requirements to an offer.',
  'Inspection Report': 'Inspection / trial report listing observations, non-conformities (NCRs), SAT/UNSAT results.',
  'Drawing': 'Engineering drawing — SLD, schematic, GA plan, P&ID, cable block diagram (PDF/image/CAD).',
  'Build Specification': 'The shipbuilding/build specification describing the vessel and its systems.',
  'RFP / Tender': 'Request for Proposal / tender / invitation to bid inviting offers.',
  'General Document': 'Anything that does not clearly fit the above (manuals, standards, notes, correspondence).',
};

async function classifyDocType(text, name = '') {
  const h = heuristicDocType(text, name);
  if (h) return h;
  try {
    const prompt = `You classify shipyard engineering documents. Choose EXACTLY ONE category that best describes the document below, based on its overall purpose (not an incidental keyword).

Categories:
${DOC_TYPES.map(t => `- ${t}: ${DOC_TYPE_HINTS[t] || ''}`).join('\n')}

Reply with ONLY the exact category name.

Document file name: ${name || '(unknown)'}
Document excerpt:
${text.slice(0, 4000)}`;
    const out = (await generateText(prompt, { temperature: 0, maxOutputTokens: 24 })).trim();
    // Prefer an exact category match; fall back to a contained match.
    const exact = DOC_TYPES.find(t => out.toLowerCase() === t.toLowerCase());
    const match = exact || DOC_TYPES.find(t => out.toLowerCase().includes(t.toLowerCase()));
    return match || 'General Document';
  } catch (_) {
    return 'General Document';
  }
}

module.exports = { DOC_TYPES, classifyDocType, heuristicDocType };
