'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Excel workbook builder (SheetJS / xlsx)
// Produces a multi-sheet .xlsx Buffer from a portable sheet specification:
//   sheets = [{
//     name:    'Cable Schedule',
//     columns: ['Sl.No', 'Cable Tag', ...],     // header labels
//     rows:    [ { 'Cable Tag': 'MB-01', ... }  // object keyed by label, OR
//              | ['1', 'MB-01', ...] ],          // positional array
//     title:   'Optional title row',
//     meta:    [['Drawing No', '80304F'], ...],  // optional key/value banner rows
//   }, …]
// ─────────────────────────────────────────────────────────────────────────────

const XLSX = require('xlsx');

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildSheet({ name, columns = [], rows = [], title, meta }) {
  const aoa = [];

  if (title) aoa.push([title]);
  if (Array.isArray(meta)) for (const m of meta) aoa.push(m);
  if ((title || meta) && columns.length) aoa.push([]); // spacer before table

  const headerRowIdx = aoa.length;
  aoa.push(columns);

  for (const row of rows) {
    if (Array.isArray(row)) {
      aoa.push(columns.map((_, i) => cellToString(row[i])));
    } else {
      aoa.push(columns.map(c => cellToString(row[c])));
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths from longest content (cap at 60 chars)
  ws['!cols'] = columns.map((c, i) => {
    let max = String(c || '').length;
    for (const row of rows) {
      const val = Array.isArray(row) ? row[i] : row[c];
      const len = cellToString(val).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 8), 60) };
  });

  // Autofilter across the header row
  if (columns.length) {
    const lastCol = XLSX.utils.encode_col(columns.length - 1);
    const lastRow = headerRowIdx + rows.length + 1;
    ws['!autofilter'] = { ref: `${XLSX.utils.encode_cell({ r: headerRowIdx, c: 0 })}:${lastCol}${lastRow}` };
  }

  // Freeze the header row
  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 };

  return ws;
}

/**
 * @param {Array} sheets  Portable sheet specifications (see module header)
 * @returns {Buffer} .xlsx file bytes
 */
function buildWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  const list = (Array.isArray(sheets) && sheets.length) ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }];

  const usedNames = new Set();
  for (const spec of list) {
    // Excel sheet names: ≤31 chars, no : \ / ? * [ ], must be unique
    let base = (spec.name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
    let name = base, n = 2;
    while (usedNames.has(name.toLowerCase())) { name = `${base.slice(0, 28)} ${n++}`; }
    usedNames.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, buildSheet(spec), name);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildWorkbook, buildSheet };
