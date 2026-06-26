'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Ship Cost Estimation Assistant  (HSL MVP item 17)
//
// Takes an AI-generated Bill of Materials and produces a preliminary ship cost
// estimate using representative (dummy) unit rates, identifies approved vendors
// from a sample vendor database, auto-prepares vendor-wise Budgetary Quotation
// (BQ) enquiry documents/emails for Administrator review & dispatch, and updates
// the estimate when sample BQ rates are provided — with full traceability.
//
//   GET  /api/cost/vendors            sample approved-vendor database
//   POST /api/cost/estimate           { bom:[...], columns?, project? } → cost summary
//   POST /api/cost/enquiries          { bom:[...], project? } → vendor-wise BQ enquiries
//   POST /api/cost/update             { bom:[...], bqs:[{vendor,item,rate}] } → re-estimate
//
// Deterministic + dependency-free (no LLM) so the demo is instant and repeatable.
// Rates are clearly flagged as representative/dummy for the MVP.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();

// ── Sample approved-vendor database (representative, for MVP demonstration) ────
// Each category: matching keywords, a base unit rate (INR) and approved vendors.
const VENDOR_DB = [
  { category: 'Diesel Generator',      discipline: 'Electrical', keywords: ['generator', 'dg set', 'genset', 'alternator'], baseRate: 4500000, vendors: ['Cummins India', 'Kirloskar Oil Engines', 'Wärtsilä India'] },
  { category: 'Main Engine / Propulsion', discipline: 'Machinery', keywords: ['main engine', 'propulsion', 'propeller', 'shaft', 'gearbox', 'thruster'], baseRate: 18000000, vendors: ['MAN Energy Solutions', 'Wärtsilä India', 'Caterpillar Marine'] },
  { category: 'Pump',                  discipline: 'Machinery', keywords: ['pump'], baseRate: 350000, vendors: ['KSB Pumps', 'Grundfos India', 'Kirloskar Brothers'] },
  { category: 'Switchboard / Panel',   discipline: 'Electrical', keywords: ['switchboard', 'panel', 'mcc', 'distribution board', 'msb', 'esb'], baseRate: 1200000, vendors: ['L&T Electrical', 'Siemens India', 'Schneider Electric'] },
  { category: 'Cable',                 discipline: 'Electrical', keywords: ['cable', 'wire', 'conductor'], baseRate: 250, vendors: ['Polycab India', 'KEI Industries', 'Havells India'] },
  { category: 'HVAC / Air Conditioning', discipline: 'HVAC', keywords: ['hvac', 'air condition', 'ac plant', 'chiller', 'ahu', 'ventilation', 'fan'], baseRate: 800000, vendors: ['Blue Star', 'Voltas', 'Daikin India'] },
  { category: 'Navigation / Communication', discipline: 'Electrical', keywords: ['radar', 'gps', 'navigation', 'gyro', 'echo sounder', 'communication', 'vhf', 'ais', 'compass'], baseRate: 900000, vendors: ['Furuno', 'JRC (Japan Radio)', 'Cobham SAILOR'] },
  { category: 'Valve',                 discipline: 'Piping', keywords: ['valve', 'cock', 'strainer'], baseRate: 45000, vendors: ['L&T Valves', 'Audco India', 'KSB Valves'] },
  { category: 'Public Address System', discipline: 'Electrical', keywords: ['public address', 'pa system', 'speaker', 'talkback', 'intercom'], baseRate: 60000, vendors: ['Bosch Security', 'Ahuja Radios', 'TOA Electronics'] },
  { category: 'Lighting',              discipline: 'Electrical', keywords: ['light', 'luminaire', 'fixture', 'lamp', 'flood light'], baseRate: 8500, vendors: ['Wipro Lighting', 'Philips India', 'Bajaj Electricals'] },
  { category: 'Fire Detection / Safety', discipline: 'Outfit', keywords: ['fire', 'detector', 'smoke', 'extinguisher', 'co2', 'sprinkler', 'alarm'], baseRate: 35000, vendors: ['Honeywell', 'Siemens Building Tech', 'Minimax'] },
  { category: 'Steering Gear',         discipline: 'Machinery', keywords: ['steering', 'rudder'], baseRate: 5500000, vendors: ['Rolls-Royce Marine', 'Kongsberg Maritime', 'Flutek'] },
  { category: 'Pipe / Fitting',        discipline: 'Piping', keywords: ['pipe', 'flange', 'fitting', 'elbow', 'tee', 'coupling'], baseRate: 1800, vendors: ['Jindal SAW', 'Ratnamani Metals', 'APL Apollo'] },
  { category: 'Steel / Hull Material', discipline: 'Hull', keywords: ['plate', 'steel', 'frame', 'stiffener', 'bracket', 'girder'], baseRate: 75000, vendors: ['SAIL', 'Tata Steel', 'JSW Steel'] },
  { category: 'Anchor / Mooring',      discipline: 'Outfit', keywords: ['anchor', 'chain', 'mooring', 'capstan', 'windlass', 'bollard'], baseRate: 650000, vendors: ['SEC Industries', 'Ramnath & Co', 'MacGregor'] },
];

const FALLBACK = { category: 'General Equipment', discipline: 'General', baseRate: 120000, vendors: ['Approved Vendor (to be finalised)'] };

// Vendors that are (primarily) foreign OEMs → an "Import" line in the cost
// template (priced in foreign currency at the applicable exchange RATE).
const IMPORT_MARKERS = ['man energy', 'wärtsilä', 'wartsila', 'caterpillar', 'furuno', 'jrc', 'japan radio', 'cobham', 'sailor', 'honeywell', 'rolls-royce', 'kongsberg', 'macgregor', 'daikin', 'grundfos', 'siemens building', 'schneider', 'bosch', 'toa electronics', 'philips', 'minimax'];
function originOf(cat) {
  const v = ((cat.vendors && cat.vendors[0]) || '').toLowerCase();
  return IMPORT_MARKERS.some(m => v.includes(m)) ? 'Import' : 'Indigenous';
}

// Default estimation parameters for the HSL cost template. All overridable per
// request so the estimate stays configurable (overheads, escalation, FX, schedule).
const DEFAULT_PARAMS = {
  overheadPct:       20,    // OBS, SME & STE, Docs, Training, etc. loading on basic cost
  escalationRate:    5,     // % per annum
  escalationPeriod:  1.5,   // years (to mid-point of delivery)
  usdRate:           84,    // ₹ per USD for Import lines
  deliveryMonths:    18,    // schedule length → mid-point of delivery date
};

const fmtINR = n => '₹' + Math.round(n).toLocaleString('en-IN');
const num = v => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };

// ── Deterministic date helpers (relative to "today") for LPP/BQ + delivery ─────
function addMonths(d, m) { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; }
function addDays(d, n)   { const x = new Date(d); x.setDate(x.getDate() + Math.round(n)); return x; }
const fmtDate = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
// Short reference initials from a category name, e.g. "Diesel Generator" → "DG".
const initials = s => (s || 'GEN').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);

// Pick the column whose header matches a pattern.
function col(columns, re) { return (columns || []).find(c => re.test(c)); }

function classify(name) {
  const n = (name || '').toLowerCase();
  for (const v of VENDOR_DB) if (v.keywords.some(k => n.includes(k))) return v;
  return FALLBACK;
}

// A stable pseudo-random multiplier in [0.8, 1.25] derived from the item name,
// so the representative rate varies item-to-item but is repeatable.
function jitter(name) {
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return 0.8 + (h % 45) / 100;
}

function unitRate(cat, name, capacity) {
  const capFactor = 1 + Math.min(num(capacity), 5000) / 1000 * 0.15;   // bigger capacity → higher rate
  return Math.round(cat.baseRate * jitter(name) * capFactor);
}

// Build a normalised line-item view of the BOM with vendor + dummy rate, costed
// into the prescribed HSL cost-estimate template (LPP/BQ source, Indg/Import,
// currency & RATE, basic cost, cost incl. overheads, and escalation in INR/Crs).
function priceBom(bom, columns, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const nameCol = col(columns, /equipment|item|material|name/i) || (columns || [])[0] || 'Equipment Name';
  const qtyCol  = col(columns, /qty|quantity/i);
  const capCol  = col(columns, /capacity|rating|kw|size/i);
  const discCol = col(columns, /discipline/i);
  const sysCol  = col(columns, /\bsystem\b/i);

  const now = new Date();
  const escFactor   = Math.pow(1 + p.escalationRate / 100, p.escalationPeriod);
  const midDelivery = fmtDate(addMonths(now, p.deliveryMonths / 2));   // mid-point of delivery

  return (bom || []).map((r, i) => {
    const name = (r[nameCol] || r['Equipment Name'] || r['Item'] || `Item ${i + 1}`).toString();
    const cat  = classify(name);
    const qty  = Math.max(1, num(qtyCol ? r[qtyCol] : r['Quantity']) || 1);
    const cap  = capCol ? r[capCol] : (r['Capacity'] || '');
    const rate = unitRate(cat, name, cap);   // representative basic unit cost in INR
    const discipline = (discCol && r[discCol]) ? r[discCol] : cat.discipline;
    const system = (sysCol && r[sysCol]) ? r[sysCol] : (cat.category);

    const origin       = originOf(cat);
    const isImport     = origin === 'Import';
    const currency     = isImport ? 'USD' : 'INR';
    const exchangeRate = isImport ? p.usdRate : 1;          // RATE (₹ per unit currency)
    const unitCost     = Math.round(rate / exchangeRate);   // unit cost in quotation currency
    const basicCost    = Math.round(rate * qty);            // Estimated Basic cost (INR)
    const totalNoEsc   = Math.round(basicCost * (1 + p.overheadPct / 100));  // incl OBS/SME&STE/Docs/Training
    const totalWithEsc = Math.round(totalNoEsc * escFactor);
    const totalCrs     = +(totalWithEsc / 1e7).toFixed(4);

    // Representative cost source: a Last-Purchase-Price record by default; a row
    // is switched to a BQ reference once a Budgetary Quotation is applied (see /update).
    const lppDate   = fmtDate(addMonths(now, -(6 + (i % 12))));   // a recent past LPP
    const reference = `LPP/${initials(cat.category)}/${addMonths(now, -(6 + (i % 12))).getFullYear()}`;

    return {
      // ── prescribed template fields ─────────────────────────────────────────
      slNo: i + 1, equipment: name, qty,
      unitCost, costSource: 'LPP', reference, costDate: lppDate,
      origin, currency, exchangeRate, basicCost,
      totalNoEsc, midDelivery,
      escalationPeriod: p.escalationPeriod, escalationRate: p.escalationRate,
      totalWithEsc, totalCrs,
      // ── internal/traceability (used by vendor enquiries & summaries) ───────
      category: cat.category, discipline, system,
      unitRate: rate, amount: totalWithEsc, vendors: cat.vendors,
      priceSource: 'Representative (LPP) rate',
      basis: `Representative ${origin} unit cost for "${cat.category}"${cap ? ` · capacity ${cap}` : ''} × qty ${qty}; +${p.overheadPct}% OBS/SME&STE/Docs/Training; escalated ${p.escalationRate}%/yr × ${p.escalationPeriod} yr`,
    };
  });
}

function summarise(items) {
  const byDiscipline = {}, bySystem = {};
  let total = 0;
  for (const it of items) {
    total += it.amount;
    byDiscipline[it.discipline] = (byDiscipline[it.discipline] || 0) + it.amount;
    bySystem[it.system] = (bySystem[it.system] || 0) + it.amount;
  }
  const toRows = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, amount: v, amountFmt: fmtINR(v) }));
  return { total, totalFmt: fmtINR(total), totalCrs: +(total / 1e7).toFixed(4), byDiscipline: toRows(byDiscipline), bySystem: toRows(bySystem) };
}

// ── GET /api/cost/vendors ─────────────────────────────────────────────────────
router.get('/vendors', (req, res) => {
  res.json({ vendors: VENDOR_DB.map(({ category, discipline, vendors, baseRate }) => ({ category, discipline, vendors, indicativeBaseRate: fmtINR(baseRate) })) });
});

// ── POST /api/cost/estimate ───────────────────────────────────────────────────
router.post('/estimate', (req, res) => {
  try {
    const { bom = [], columns = [], project = '', params = {} } = req.body || {};
    if (!Array.isArray(bom) || !bom.length) return res.status(400).json({ error: 'Provide a BOM (bom[]).' });
    const items = priceBom(bom, columns, params);
    const summary = summarise(items);
    res.json({ project, currency: 'INR', params: { ...DEFAULT_PARAMS, ...params }, note: 'Preliminary estimate in the HSL cost format using representative (LPP) unit rates for MVP demonstration. Costs include OBS, SME & STE, Docs & Training, and are escalated to the mid-point of delivery. Apply Budgetary Quotations to refine.', items, ...summary });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/cost/enquiries ──────────────────────────────────────────────────
// Auto-prepare vendor-wise BQ enquiry documents/emails from the BOM for the
// Administrator to review and dispatch through HSL's external email system.
router.post('/enquiries', (req, res) => {
  try {
    const { bom = [], columns = [], project = '' } = req.body || {};
    if (!Array.isArray(bom) || !bom.length) return res.status(400).json({ error: 'Provide a BOM (bom[]).' });
    const items = priceBom(bom, columns);

    // Group items by primary approved vendor (first listed) for the enquiry.
    const byVendor = {};
    for (const it of items) {
      const vendor = it.vendors[0];
      byVendor[vendor] = byVendor[vendor] || { vendor, category: it.category, items: [] };
      byVendor[vendor].items.push(it);
    }

    const ref = `HSL/BQ/${(project || 'PRJ').replace(/[^A-Za-z0-9]+/g, '').slice(0, 8).toUpperCase() || 'PRJ'}/${new Date().getFullYear()}`;
    const enquiries = Object.values(byVendor).map((g, idx) => {
      const lines = g.items.map((it, i) => `   ${i + 1}. ${it.equipment} — Qty: ${it.qty}${/cable|pipe/i.test(it.category) ? ' (per unit)' : ''}`).join('\n');
      const body =
`To:      ${g.vendor}
Subject: Request for Budgetary Quotation — ${g.category} — ${project || 'New Shipbuilding Project'}
Ref:     ${ref}/${String(idx + 1).padStart(2, '0')}

Dear Sir/Madam,

Hindustan Shipyard Limited (HSL) is preparing a preliminary cost estimate for ${project || 'a new shipbuilding project'} and requests your most competitive Budgetary Quotation (BQ) for the following ${g.category.toLowerCase()} item(s):

${lines}

Kindly include: unit price, applicable taxes/duties, delivery period, quotation validity, country of origin, and applicable warranty. Please also indicate compliance with the relevant IRS/class requirements.

We request your offer within 14 days from the date of this enquiry. Please quote against our reference ${ref}/${String(idx + 1).padStart(2, '0')} in all correspondence.

Thanking you,
For Hindustan Shipyard Limited
(Design & Estimation Department)`;
      return { vendor: g.vendor, category: g.category, itemCount: g.items.length, reference: `${ref}/${String(idx + 1).padStart(2, '0')}`, status: 'Draft — pending Administrator review', email: body };
    });

    res.json({ project, reference: ref, vendorCount: enquiries.length, enquiries });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/cost/update ─────────────────────────────────────────────────────
// Re-estimate using sample Budgetary Quotation rates, overriding dummy rates.
// bqs: [{ vendor?, item, rate }]  (item matched case-insensitively by name substring)
router.post('/update', (req, res) => {
  try {
    const { bom = [], columns = [], bqs = [], project = '', params = {} } = req.body || {};
    if (!Array.isArray(bom) || !bom.length) return res.status(400).json({ error: 'Provide a BOM (bom[]).' });
    const p = { ...DEFAULT_PARAMS, ...params };
    const escFactor = Math.pow(1 + p.escalationRate / 100, p.escalationPeriod);
    const items = priceBom(bom, columns, params);
    let applied = 0;
    for (const it of items) {
      const match = (bqs || []).find(b => b.item && it.equipment.toLowerCase().includes(String(b.item).toLowerCase()));
      if (match && num(match.rate) > 0) {
        // BQ rate is the basic unit cost in INR; recompute the full template line.
        const rateINR = Math.round(num(match.rate));
        it.unitRate     = rateINR;
        it.costSource   = 'BQ';
        it.currency     = 'INR';        // a received BQ is quoted/normalised to INR here
        it.exchangeRate = 1;
        it.unitCost     = rateINR;
        it.reference    = `BQ${match.vendor ? ` · ${match.vendor}` : ''}`;
        it.costDate     = fmtDate(addDays(new Date(), 90));   // BQ validity
        it.basicCost    = it.qty * rateINR;
        it.totalNoEsc   = Math.round(it.basicCost * (1 + p.overheadPct / 100));
        it.totalWithEsc = Math.round(it.totalNoEsc * escFactor);
        it.totalCrs     = +(it.totalWithEsc / 1e7).toFixed(4);
        it.amount       = it.totalWithEsc;
        it.priceSource  = `Budgetary Quotation${match.vendor ? ` · ${match.vendor}` : ''}`;
        it.basis        = `BQ unit cost${match.vendor ? ` from ${match.vendor}` : ''} × qty ${it.qty}; +${p.overheadPct}% OBS/SME&STE/Docs/Training; escalated ${p.escalationRate}%/yr × ${p.escalationPeriod} yr`;
        applied++;
      }
    }
    const summary = summarise(items);
    res.json({ project, currency: 'INR', params: p, bqApplied: applied, note: `${applied} item(s) updated from Budgetary Quotations; remaining items use representative (LPP) rates.`, items, ...summary });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = router;
