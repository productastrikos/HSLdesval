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
// DWG is AutoCAD's binary format — there is no reliable pure-JS DWG decoder, so
// we recover the drawing's version and any embedded ASCII labels (best effort)
// and tell the user that exporting to DXF (or PDF) yields the richest result.
// ─────────────────────────────────────────────────────────────────────────────

let DxfParser = null;
try { DxfParser = require('dxf-parser'); } catch (_) { DxfParser = null; }

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

function entText(e) {
  return (e.text || e.string || '').toString().replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
}
function entPos(e) {
  const p = e.startPoint || e.position || e.insertionPoint || (e.vertices && e.vertices[0]) || {};
  return { x: p.x || 0, y: p.y || 0 };
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

  const texts = [];
  for (const e of entities) {
    if (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTRIB') {
      const t = entText(e);
      if (t) { const p = entPos(e); texts.push({ text: t, x: p.x, y: p.y, layer: e.layer || '' }); }
    }
  }

  // Closed polylines = candidate compartments / zones.
  const regions = [];
  for (const e of entities) {
    if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') continue;
    const verts = (e.vertices || []).map(v => ({ x: v.x, y: v.y }));
    const closed = e.shape === true || e.closed === true || (e.flags & 1) === 1;
    if (!closed || verts.length < 3) continue;
    const area = polyArea(verts);
    if (area <= 0) continue;
    const c = centroid(verts);
    // Label region from the nearest text entity.
    let label = '', best = Infinity;
    for (const t of texts) {
      const d = (t.x - c.x) ** 2 + (t.y - c.y) ** 2;
      if (d < best) { best = d; label = t.text; }
    }
    const areaM2 = units.perMetre ? +(area / (units.perMetre ** 2)).toFixed(2) : null;
    regions.push({ label: label || '(unlabelled)', layer: e.layer || '', area: +area.toFixed(2), areaM2 });
  }
  regions.sort((a, b) => b.area - a.area);

  const summary = buildSummary({ kind: 'dxf', name, version: '', units: units.name, texts, regions });
  return {
    kind: 'dxf', version: '', units: units.name, texts, regions, summary,
    note: regions.length ? '' : 'No closed polylines were found, so compartment areas could not be computed; text labels were still extracted.',
  };
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

function parseCad(buffer, name = 'drawing') {
  const isDxf = /\.dxf$/i.test(name) || looksLikeDxf(buffer);
  if (isDxf) return parseDxf(buffer, name);
  return scanBinary(buffer, name, 'dwg');
}

module.exports = { parseCad, isCadName };
