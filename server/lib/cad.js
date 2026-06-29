'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CAD reader for AutoCAD drawings (.dxf / .dwg)
//
//   parseCad(buffer, name) → {
//     kind:    'dxf' | 'dwg',
//     version, units,
//     texts:   [{ text, x, y, layer }],
//     regions: [{ label, layer, area, areaM2 }],   // closed polylines = compartments
//     summary, note,
//   }
//
// DXF (ASCII interchange format) is parsed structurally with `dxf-parser`: we
// pull every text label and compute the enclosed area of each closed polyline
// (a GA-plan compartment) with the shoelace formula, then label each region from
// the nearest text. The resulting `summary` is fed to the vision/text model so
// the normal AI table extraction works on CAD just as it does on PDFs/images.
//
// DWG is AutoCAD's binary format. We decode it in-process with a WebAssembly
// build of LibreDWG (@mlightcad/libredwg-web — pure WASM, no native binary, so
// it runs identically on Windows and the Linux host). We read the DWG into an
// in-memory database (dwg_read_data + convert) and extract entities directly —
// NOT via the library's dwg_write_dxf path, whose DXF writer crashes ("memory
// access out of bounds") on many real-world AC1027/AC1032 (AutoCAD 2013/2018)
// drawings. The in-memory reader decodes those same files cleanly. If decoding
// ever fails we fall back to the previous best-effort ASCII-label recovery.
// ─────────────────────────────────────────────────────────────────────────────

let DxfParser = null;
try { DxfParser = require('dxf-parser'); } catch (_) { DxfParser = null; }

// LibreDWG is shipped as an ESM-only WASM module; load it once via dynamic
// import() from this CommonJS file and cache the ready instance + module.
let _libredwgPromise = null;
function getLibreDwg() {
  if (!_libredwgPromise) {
    _libredwgPromise = import('@mlightcad/libredwg-web')
      .then(async m => ({ inst: await m.LibreDwg.create(), fileType: m.Dwg_File_Type }))
      .catch(err => { _libredwgPromise = null; throw err; });
  }
  return _libredwgPromise;
}

// Decode a binary DWG buffer to an in-memory DwgDatabase ({ entities, header, ... })
// or null if it cannot be decoded. The decoded native pointer is always freed.
async function dwgToDatabase(buffer) {
  let lib;
  try {
    lib = await getLibreDwg();
    const { inst, fileType } = lib;
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const ptr = inst.dwg_read_data(ab, fileType.DWG);
    if (ptr == null) return null;
    try {
      const db = inst.convert(ptr);
      return (db && Array.isArray(db.entities)) ? db : null;
    } finally {
      try { inst.dwg_free(ptr); } catch (_) { /* best effort */ }
    }
  } catch (_) {
    // A hard WASM fault can corrupt the shared instance; drop it so the next
    // upload starts from a fresh module.
    _libredwgPromise = null;
    return null;
  }
}

// $INSUNITS code → { name, perMetre } (model units in one metre)
const DXF_UNITS = {
  0: { name: 'unitless', perMetre: 0 },
  1: { name: 'inches',   perMetre: 39.3701 },
  2: { name: 'feet',     perMetre: 3.28084 },
  4: { name: 'mm',       perMetre: 1000 },
  5: { name: 'cm',       perMetre: 100 },
  6: { name: 'm',        perMetre: 1 },
};

function looksLikeDxf(buffer) {
  const head = buffer.slice(0, 2048).toString('latin1');
  return /\bSECTION\b/.test(head) && /\bHEADER\b|\bENTITIES\b/.test(head);
}

function dwgVersion(buffer) {
  const tag = buffer.slice(0, 6).toString('latin1');
  const map = {
    AC1014: 'AutoCAD R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004',
    AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013',
    AC1032: 'AutoCAD 2018',
  };
  return /^AC10\d\d$/.test(tag) ? (map[tag] || tag) : '';
}

function polyArea(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    if (!p || !q || p.x == null || q.y == null) return 0;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function centroid(vertices) {
  let x = 0, y = 0, n = 0;
  for (const v of vertices) { if (v && v.x != null && v.y != null) { x += v.x; y += v.y; n++; } }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

function cleanLabel(s) {
  return (s || '').toString()
    .replace(/\\[A-Za-z][^;]*;/g, '')   // MTEXT formatting runs: \Fromans|c0;  \C2;
    .replace(/\\P/g, ' ')               // MTEXT paragraph break  → space
    .replace(/\\~/g, ' ')               // MTEXT non-breaking space
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function entText(e) {
  // dxf-parser uses a string; LibreDWG's DwgDatabase nests it for ATTRIB (e.text.text).
  let t = e.text;
  if (t && typeof t === 'object') t = t.text;
  return cleanLabel(t || e.string || '');
}
function entPos(e) {
  const nested = (e.text && typeof e.text === 'object') ? e.text.startPoint : null;
  const p = e.startPoint || e.position || e.insertionPoint || nested || (e.vertices && e.vertices[0]) || {};
  return { x: p.x || 0, y: p.y || 0 };
}
// AutoCAD anonymous / internal block names: *U3, *D1, *Xn (and the A$Cxxxx names
// LibreDWG emits for them). These are not meaningful labels.
function isAnonBlock(name) {
  return /^\*/.test(name) || /^A\$C[0-9A-F]+$/i.test(name);
}
function isClosedPoly(e) {
  return e.shape === true || e.closed === true || ((e.flags & 1) === 1) || ((e.flag & 1) === 1);
}

// Pull text labels and closed-polyline regions out of an entity list. Works for
// both dxf-parser entities and LibreDWG DwgDatabase entities (their TEXT/MTEXT/
// ATTRIB/LWPOLYLINE shapes differ slightly; the helpers above bridge them).
function extractEntities(entities, units) {
  const texts = [];
  for (const e of entities) {
    if (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTRIB') {
      const t = entText(e);
      if (t) { const p = entPos(e); texts.push({ text: t, x: p.x, y: p.y, layer: e.layer || '' }); }
    } else if (e.type === 'INSERT' && e.name && !isAnonBlock(e.name)) {
      // Block name is the component/symbol type (e.g. "LED FLOOD LIGHT 100W") —
      // valuable on schematics/SLDs that have no closed compartments. Anonymous
      // internal blocks (*U, A$C…) are skipped — they're noise, not labels.
      const p = entPos(e); texts.push({ text: cleanLabel(e.name), x: p.x, y: p.y, layer: e.layer || '' });
    }
  }

  const regions = [];
  for (const e of entities) {
    if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') continue;
    const verts = (e.vertices || []).map(v => ({ x: v.x, y: v.y }));
    if (!isClosedPoly(e) || verts.length < 3) continue;
    const area = polyArea(verts);
    if (area <= 0) continue;
    const c = centroid(verts);
    let label = '', best = Infinity;
    for (const t of texts) {
      const d = (t.x - c.x) ** 2 + (t.y - c.y) ** 2;
      if (d < best) { best = d; label = t.text; }
    }
    const areaM2 = units.perMetre ? +(area / (units.perMetre ** 2)).toFixed(2) : null;
    regions.push({ label: label || '(unlabelled)', layer: e.layer || '', area: +area.toFixed(2), areaM2 });
  }
  regions.sort((a, b) => b.area - a.area);
  return { texts, regions };
}

function parseDxf(buffer, name) {
  if (!DxfParser) return scanBinary(buffer, name, 'dxf');
  let dxf;
  try {
    dxf = new DxfParser().parseSync(buffer.toString('latin1'));
  } catch (err) {
    return { ...scanBinary(buffer, name, 'dxf'), note: `DXF could not be fully parsed (${err.message}); recovered text only.` };
  }
  const entities = (dxf && dxf.entities) || [];
  const unitsCode = dxf?.header?.$INSUNITS ?? 0;
  const units = DXF_UNITS[unitsCode] || DXF_UNITS[0];

  const { texts, regions } = extractEntities(entities, units);

  const summary = buildSummary({ kind: 'dxf', name, version: '', units: units.name, texts, regions });
  return {
    kind: 'dxf', version: '', units: units.name, texts, regions, summary,
    note: regions.length ? '' : 'No closed polylines were found, so compartment areas could not be computed; text labels were still extracted.',
  };
}

// Build the parse result from a decoded LibreDWG in-memory database.
function parseDwgDb(db, name, version) {
  const unitsCode = db?.header?.$INSUNITS ?? 0;
  const units = DXF_UNITS[unitsCode] || DXF_UNITS[0];
  const { texts, regions } = extractEntities(db.entities, units);
  const summary = buildSummary({ kind: 'dwg', name, version, units: units.name, texts, regions });
  const note = regions.length
    ? `Decoded binary DWG${version ? ` (${version})` : ''}: ${texts.length} text labels and ${regions.length} closed regions (areas computed).`
    : `Decoded binary DWG${version ? ` (${version})` : ''}: ${texts.length} text labels. No closed polylines were found, so compartment areas could not be computed.`;
  return { kind: 'dwg', version, units: units.name, texts, regions, summary, note };
}

// Best-effort recovery of printable ASCII labels from a binary file.
function scanBinary(buffer, name, kind) {
  const version = kind === 'dwg' ? dwgVersion(buffer) : '';
  const ascii = buffer.toString('latin1');
  const runs = ascii.match(/[\x20-\x7E]{4,}/g) || [];
  const seen = new Set();
  const labels = [];
  for (const r of runs) {
    const s = r.trim();
    // keep human-ish labels: has letters, not mostly symbols, reasonable length
    if (!/[A-Za-z]/.test(s)) continue;
    if (s.length > 60) continue;
    if (/^[A-Za-z]{1,2}\d{0,2}$/.test(s) && s.length < 3) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(s);
    if (labels.length >= 400) break;
  }
  const texts = labels.map(t => ({ text: t, x: 0, y: 0, layer: '' }));
  const summary = buildSummary({ kind, name, version, units: '', texts, regions: [] });
  return {
    kind, version, units: '', texts, regions: [], summary,
    note: kind === 'dwg'
      ? `Binary DWG${version ? ` (${version})` : ''}: recovered ${labels.length} embedded text labels. For full geometry, compartment areas and reliable specs, export the drawing to DXF or PDF from AutoCAD and re-upload.`
      : `Recovered ${labels.length} text labels.`,
  };
}

function buildSummary({ kind, name, version, units, texts, regions }) {
  const lines = [];
  lines.push(`CAD DRAWING (${kind.toUpperCase()}${version ? ` · ${version}` : ''}): ${name}`);
  if (units) lines.push(`Drawing units: ${units}`);
  if (regions.length) {
    lines.push('', `CLOSED REGIONS / COMPARTMENTS (computed enclosed area, largest first):`);
    for (const r of regions.slice(0, 120)) {
      lines.push(`- ${r.label}${r.layer ? ` [layer ${r.layer}]` : ''}: area ${r.area}${r.areaM2 != null ? ` model-units² (≈ ${r.areaM2} m²)` : ' model-units²'}`);
    }
  }
  if (texts.length) {
    lines.push('', `TEXT LABELS ON DRAWING (${texts.length}):`);
    const uniq = [...new Set(texts.map(t => t.text))].slice(0, 400);
    lines.push(uniq.join(' | '));
  }
  return lines.join('\n');
}

function isCadName(name = '', mime = '') {
  return /\.(dwg|dxf)$/i.test(name) || /dwg|dxf|autocad/i.test(mime);
}

async function parseCad(buffer, name = 'drawing') {
  const isDxf = /\.dxf$/i.test(name) || looksLikeDxf(buffer);
  if (isDxf) return parseDxf(buffer, name);

  // Binary DWG → decode in-memory with LibreDWG WASM → extract entities directly.
  const db = await dwgToDatabase(buffer);
  if (db && db.entities.length) return parseDwgDb(db, name, dwgVersion(buffer));

  return { ...scanBinary(buffer, name, 'dwg'), note: `Could not fully decode this DWG; recovered embedded text labels only. If results are thin, export the drawing to DXF or PDF from AutoCAD and re-upload.` };
}

module.exports = { parseCad, isCadName };
