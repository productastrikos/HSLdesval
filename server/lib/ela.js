'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Electrical Load Analysis (ELA) workbook parser + deterministic load rollup.
//
// Reads the standard HSL ELA workbook format (one sheet per switchboard —
// "230V ESB", "415V MSB", "690V MSB Fwd", … — each a consumer-by-consumer load
// table with a repeating [D.F. | No. in use | Load (kW)] column triple per
// vessel operating mode, e.g. Cruising / Patrolling / Harbour / Emergency), and
// rolls every switchboard's per-mode totals up into a ship-wide summary:
// worst-case main-bus load, worst-case emergency-bus load, and each ESB's
// transformer minimum, converted to kVA and margined.
//
// All arithmetic here is deterministic (plain sums) — the LLM is deliberately
// NOT asked to add up spreadsheet rows; it only judges what standard generator/
// transformer capacity and count satisfy the computed numbers (see bom.js).
// ─────────────────────────────────────────────────────────────────────────────

const XLSX = require('xlsx');

const SPREADSHEET_RE = /\.(xlsx|xlsm|xls)$/i;
function isSpreadsheetName(name) { return SPREADSHEET_RE.test(String(name || '')); }

// Sheets that hold a per-consumer load table (a switchboard/distribution board).
// Skip cover pages, graphs, and "…Work" scratch duplicates of a canonical sheet.
// This is deliberately broad (also matches distribution boards like "415V DIVING
// DB") so every load table is parsed and shown — classification into the
// main/emergency rollup below is stricter, to avoid double-counting a bus that
// is itself fed from another bus already in the rollup.
const BUS_SHEET_RE   = /\b(ESB|MSB|DESB|DB)\b|\bEmg\b/i;
const SKIP_SHEET_RE  = /\bwork\b|^graph$|^sheet\d*$|^s\d/i;
const HEADER_TOKEN_RE = /^sl\.?\s*no/i;
const DF_TOKEN_RE     = /^d\.?f\.?$/i;
const LF_TOKEN_RE     = /^l\.?f\.?$/i;
const LOAD_ROW_RE     = /^(total\s+)?load\b/i;

function cellStr(v) { return v == null ? '' : String(v).trim(); }

function sheetToGrid(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

// Nearest non-empty cell within [start, end] (inclusive), scanning backward
// from `end`. Deliberately does NOT look before `start` — that would bleed the
// previous mode-triple's label into this one when a cell is merged/blank.
function labelInRange(row, start, end) {
  if (!row) return '';
  for (let c = end; c >= start; c--) {
    const v = cellStr(row[c]);
    if (v) return v;
  }
  return '';
}

// Best-effort human-readable mode label for the triple spanning [start,end],
// combining distinct fragments found in up to 4 rows above the header (mode
// names are often split across 2-3 stacked rows, e.g. "SAILING" + "@ FULL SPEED").
function modeLabel(grid, headerRowIdx, start, end) {
  const frags = [];
  for (let r = Math.max(0, headerRowIdx - 4); r < headerRowIdx; r++) {
    const v = labelInRange(grid[r], start, end);
    if (v && !frags.includes(v)) frags.push(v);
  }
  return frags.join(' — ') || `Mode@${start}`;
}

// Locate the header block: the row carrying the "D.F." tokens (defines the
// repeating [D.F., No. in use, Load(kW)] column triples) and the row carrying
// "Sl.No" (the column-name row). These are the SAME row in some ELA templates
// and two SEPARATE adjacent rows in others, so both are found independently.
function locateHeader(grid) {
  let dfRowIdx = -1, nameRowIdx = -1, lfCol = -1, triples = [];
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const row = grid[r] || [];
    if (dfRowIdx === -1) {
      const t = [];
      for (let c = 0; c < row.length; c++) if (DF_TOKEN_RE.test(cellStr(row[c]))) t.push({ df: c, noInUse: c + 1, load: c + 2 });
      if (t.length) {
        dfRowIdx = r; triples = t;
        const lf = row.findIndex(c => LF_TOKEN_RE.test(cellStr(c)));
        if (lf !== -1) lfCol = lf;
      }
    }
    if (nameRowIdx === -1 && row.some(c => HEADER_TOKEN_RE.test(cellStr(c)))) nameRowIdx = r;
  }
  if (!triples.length) return null;
  const topRowIdx  = nameRowIdx === -1 ? dfRowIdx : Math.min(dfRowIdx, nameRowIdx);
  const dataStartRowIdx = (nameRowIdx === -1 ? dfRowIdx : Math.max(dfRowIdx, nameRowIdx)) + 1;
  return { labelScanFrom: topRowIdx, dataStartRowIdx, lfCol, triples };
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Parse one switchboard sheet: consumer rows + per-mode totals (recomputed from
// the consumer rows — the sheet's own "LOAD …" total row is often left at 0 in
// an unfilled template, so summing consumers ourselves is the reliable path).
function parseSwitchboardSheet(sheetName, ws) {
  const grid = sheetToGrid(ws);
  const hdr = locateHeader(grid);
  if (!hdr) return null;

  const { labelScanFrom, dataStartRowIdx, triples } = hdr;
  const modes = triples.map(t => ({ ...t, name: modeLabel(grid, labelScanFrom, t.df, t.load) }));

  const consumers = [];
  let blankStreak = 0;
  for (let r = dataStartRowIdx; r < grid.length; r++) {
    const row = grid[r] || [];
    const first = cellStr(row[0]);
    const second = cellStr(row[1]);
    if (LOAD_ROW_RE.test(first)) break;              // hit the switchboard's own total line
    if (!first && !second) { blankStreak++; if (blankStreak >= 2) break; continue; }
    blankStreak = 0;
    const hasAnyLoad = modes.some(m => num(row[m.load]) > 0);
    const noOff = num(row[2]);
    if (!second && !hasAnyLoad && !noOff) continue;   // section-heading row (e.g. "Lighting")
    consumers.push({ slNo: first, consumer: second, noOff, row });
  }

  const totals = modes.map(m => ({
    name: m.name,
    totalKw: Math.round(consumers.reduce((s, c) => s + num(c.row[m.load]), 0) * 1000) / 1000,
  }));

  // The sheet's own "Calculated Minimum Transformer Capacity" line, when present
  // (only meaningful on the 230V-level ESB/MSB sheets that feed a step-down
  // transformer) — used as a floor/sanity-check for the transformer recommendation.
  let transformerHintKva = null;
  for (const row of grid) {
    const label = cellStr(row[0]);
    if (/calculated minimum transformer capacity/i.test(label)) {
      const n = row.map(num).find((v, i) => i > 0 && v > 0);
      if (n) transformerHintKva = n;
    }
  }

  // Best-effort vessel/project identity tag from the sheet's own title banner
  // (e.g. "FAST PATROLLING VESSEL (FPV)", "OCEANOGRAPHIC RESEARCH VESSEL (ORV)")
  // — used only to warn if a "sample"/reference workbook bundles tabs from more
  // than one vessel or project, which real ELAs never do but example packs might.
  let vesselTag = '';
  for (let r = 0; r < labelScanFrom; r++) {
    const hit = (grid[r] || []).map(cellStr).find(c => /\bVESSEL\b|\bFPV\b|\bORV\b|Hull No\.?:/i.test(c));
    if (hit) { vesselTag = hit; break; }
  }

  const voltageMatch = sheetName.match(/(\d{3,4})\s*V/i);
  // Strict classification for the auto-summed main/emergency rollup — anything
  // that isn't unambiguously an MSB (main bus) or an ESB/emergency bus (incl.
  // "Emg…" sheets) is left as OTHER and shown but NOT auto-added to a total,
  // because boards like "415V DIVING DB" are often fed FROM another bus that's
  // already in the rollup (double-counting risk) rather than being independent.
  const bus = /\bMSB\b/i.test(sheetName) ? 'MSB' : (/\bESB\b/i.test(sheetName) || /\bEmg\b/i.test(sheetName)) ? 'ESB' : 'OTHER';

  return {
    sheet: sheetName,
    voltage: voltageMatch ? `${voltageMatch[1]}V` : '',
    bus,
    vesselTag,
    consumerCount: consumers.length,
    modes: totals,
    transformerHintKva,
  };
}

// Free-text engineering notes worth surfacing to the AI sizing step: existing
// generator inventory lines, explicit sizing decisions already written by an
// engineer, average power factor, and design/growth margin.
function scanNotesAndFactors(workbook) {
  const notes = [];
  let powerFactor = null;
  let marginPct = null;

  for (const sheetName of workbook.SheetNames) {
    const grid = sheetToGrid(workbook.Sheets[sheetName]);
    for (const row of grid) {
      const line = row.map(cellStr).filter(Boolean).join(' ').trim();
      if (!line) continue;
      if (/generator|shall be considered|kva\b/i.test(line) && line.length < 220) {
        if (/x\s*(diesel|emergency|harbour)\s*generator|shall be considered|generator.*kva|kva.*generator/i.test(line)) {
          notes.push(line);
        }
      }
      if (powerFactor == null) {
        const m = line.match(/average power factor[^0-9]*([0-9]*\.?[0-9]+)/i);
        if (m) powerFactor = parseFloat(m[1]);
      }
      if (marginPct == null) {
        const m = line.match(/(?:design|growth)\s*margin[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%/i);
        if (m) marginPct = parseFloat(m[1]);
      }
    }
  }
  return { notes: [...new Set(notes)].slice(0, 20), powerFactor, marginPct };
}

/**
 * Parse an ELA workbook buffer into switchboard load tables + factors.
 * @returns {{ switchboards: object[], notes: string[], powerFactor: number, marginPct: number }}
 */
function parseElaWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: false });
  const switchboards = [];

  for (const sheetName of workbook.SheetNames) {
    if (SKIP_SHEET_RE.test(sheetName)) continue;
    if (!BUS_SHEET_RE.test(sheetName)) continue;
    // Skip an exact duplicate sheet name already parsed (e.g. two "690V MSB" tabs
    // from a copy/paste) only if a differently-named canonical one also exists —
    // otherwise keep it, several vessels genuinely split Fwd/Aft switchboards.
    try {
      const parsed = parseSwitchboardSheet(sheetName, workbook.Sheets[sheetName]);
      if (parsed && parsed.modes.length && parsed.consumerCount) switchboards.push(parsed);
    } catch (_) { /* skip unparsable sheet, keep going */ }
  }

  const { notes, powerFactor, marginPct } = scanNotesAndFactors(workbook);

  // Caveat, not a hard rule: if the main-bus (MSB) sheets span more than one
  // voltage level (e.g. 690V + 415V), one may be fed from the other via a
  // step-down transformer already counted inside the higher-voltage sheet —
  // summing both would double-count. Surface this rather than silently trust it.
  const msbVoltages = new Set(switchboards.filter(s => s.bus === 'MSB').map(s => s.voltage).filter(Boolean));
  if (msbVoltages.size > 1) {
    notes.push(`Caveat: main-bus sheets span multiple voltage levels (${[...msbVoltages].join(', ')}) — verify one isn't fed from the other via a step-down transformer before trusting the combined main-bus total (that would double-count).`);
  }
  const otherSheets = switchboards.filter(s => s.bus === 'OTHER');
  if (otherSheets.length) {
    notes.push(`Not included in the main/emergency totals (ambiguous bus type — shown separately for review): ${otherSheets.map(s => s.sheet).join(', ')}.`);
  }
  // A "sample"/reference workbook can bundle leftover tabs from more than one
  // past project — a real single-vessel ELA never mixes vessel identities. The
  // length filter drops bare/partial tags (e.g. a sheet with "Hull No.:" left
  // blank) that would otherwise look like a mismatch against a fuller tag.
  const vesselTags = new Set(switchboards.map(s => s.vesselTag).filter(t => t && t.length > 15));
  if (vesselTags.size > 1) {
    notes.push(`Caveat: sheets in this workbook carry DIFFERENT vessel/project titles (${[...vesselTags].join(' | ')}) — this looks like a reference/sample pack of tabs from more than one project rather than one vessel's ELA. Totals below combine them anyway; verify against the correct single-vessel workbook before sizing real equipment.`);
  }

  return {
    switchboards,
    notes,
    powerFactor: powerFactor || 0.8,
    marginPct: marginPct != null ? marginPct : 10,
  };
}

// Roll every switchboard's per-mode totals into a ship-wide summary: worst-case
// main-bus (MSB) load and worst-case emergency-bus (ESB, emergency-mode column)
// load, each converted kW→kVA via the power factor and margined.
function summarizeLoads(parsed, overrides = {}) {
  const powerFactor = overrides.powerFactor || parsed.powerFactor || 0.8;
  const marginPct   = overrides.marginPct != null ? overrides.marginPct : (parsed.marginPct != null ? parsed.marginPct : 10);
  const toKva = (kw) => kw / powerFactor;
  const withMargin = (kw) => kw * (1 + marginPct / 100);

  // Main bus: sum MSB-classified sheets per mode name, take the worst (max) mode.
  const msbSheets = parsed.switchboards.filter(s => s.bus === 'MSB');
  const modeTotals = new Map(); // name -> kw
  for (const sb of msbSheets) {
    for (const m of sb.modes) {
      modeTotals.set(m.name, (modeTotals.get(m.name) || 0) + m.totalKw);
    }
  }
  let mainWorstCase = { name: '(no MSB data found)', kw: 0 };
  for (const [name, kw] of modeTotals) if (kw > mainWorstCase.kw) mainWorstCase = { name, kw };

  // Emergency bus: the ESB-classified sheets' own "emergency" mode column (best
  // match by name), summed across ESB sheets — this is the load the emergency
  // generator alone must carry when the main bus is dead.
  const esbSheets = parsed.switchboards.filter(s => s.bus === 'ESB');
  let emergencyKw = 0;
  const emergencyModeNames = new Set();
  for (const sb of esbSheets) {
    const em = sb.modes.find(m => /emergency/i.test(m.name));
    if (em) { emergencyKw += em.totalKw; emergencyModeNames.add(em.name); }
  }

  // Per-ESB transformer minimum: the sheet's own worst-case mode load (kVA),
  // or its own "Calculated Minimum Transformer Capacity" hint if larger.
  const transformers = esbSheets.map(sb => {
    const worst = sb.modes.reduce((a, m) => (m.totalKw > a.totalKw ? m : a), { totalKw: 0, name: '' });
    const computedKva = toKva(worst.totalKw);
    const kva = Math.max(computedKva, sb.transformerHintKva || 0);
    return { sheet: sb.sheet, voltage: sb.voltage, worstCaseMode: worst.name, loadKw: worst.totalKw, minKva: Math.round(kva * 10) / 10 };
  });

  const perSwitchboardTable = parsed.switchboards.map(sb => ({
    sheet: sb.sheet, voltage: sb.voltage, bus: sb.bus, consumerCount: sb.consumerCount,
    modes: sb.modes.map(m => ({ name: m.name, kw: m.totalKw })),
  }));

  return {
    powerFactor,
    marginPct,
    mainWorstCase: {
      modeName: mainWorstCase.name,
      loadKw: Math.round(mainWorstCase.kw * 10) / 10,
      loadKwWithMargin: Math.round(withMargin(mainWorstCase.kw) * 10) / 10,
      loadKva: Math.round(toKva(withMargin(mainWorstCase.kw)) * 10) / 10,
    },
    emergencyWorstCase: {
      modeName: [...emergencyModeNames].join(' / ') || '(no ESB emergency-mode data found)',
      loadKw: Math.round(emergencyKw * 10) / 10,
      loadKwWithMargin: Math.round(withMargin(emergencyKw) * 10) / 10,
      loadKva: Math.round(toKva(withMargin(emergencyKw)) * 10) / 10,
    },
    transformers,
    perSwitchboardTable,
  };
}

module.exports = { isSpreadsheetName, parseElaWorkbook, summarizeLoads };
