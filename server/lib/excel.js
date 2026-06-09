'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Excel workbook builder (ExcelJS — actively maintained, no SheetJS advisories)
// Produces a multi-sheet .xlsx Buffer from a portable sheet specification:
//   sheets = [{
//     name:    'Cable Schedule',
//     columns: ['Sl.No', 'Cable Tag', ...],     // header labels
//     rows:    [ { 'Cable Tag': 'MB-01', ... }  // object keyed by label, OR
//              | ['1', 'MB-01', ...] ],          // positional array
//     title:   'Optional title row',
//     meta:    [['Drawing No', '80304F'], ...],  // optional key/value banner rows
//   }, …]
//
// buildWorkbook(sheets) → Promise<Buffer> (.xlsx bytes)
// ─────────────────────────────────────────────────────────────────────────────

const ExcelJS = require('exceljs');

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function addSheet(wb, name, { columns = [], rows = [], title, meta }) {
  const ws = wb.addWorksheet(name);

  if (title) ws.addRow([title]);
  if (Array.isArray(meta)) for (const m of meta) ws.addRow(m);
  if ((title || meta) && columns.length) ws.addRow([]); // spacer before table

  const headerRow = ws.addRow(columns);
  const headerRowIdx = headerRow.number;          // 1-based
  headerRow.font = { bold: true };

  for (const row of rows) {
    const vals = Array.isArray(row)
      ? columns.map((_, i) => cellToString(row[i]))
      : columns.map(c => cellToString(row[c]));
    ws.addRow(vals);
  }

  // Column widths from longest content (cap at 60 chars)
  columns.forEach((c, i) => {
    let max = String(c || '').length;
    for (const row of rows) {
      const val = Array.isArray(row) ? row[i] : row[c];
      const len = cellToString(val).length;
      if (len > max) max = len;
    }
    ws.getColumn(i + 1).width = Math.min(Math.max(max + 2, 8), 60);
  });

  // Freeze the header row + autofilter across it
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  if (columns.length) {
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to:   { row: headerRowIdx + rows.length, column: columns.length },
    };
  }
}

/**
 * @param {Array} sheets  Portable sheet specifications (see module header)
 * @returns {Promise<Buffer>} .xlsx file bytes
 */
async function buildWorkbook(sheets) {
  const wb   = new ExcelJS.Workbook();
  const list = (Array.isArray(sheets) && sheets.length) ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }];

  const usedNames = new Set();
  for (const spec of list) {
    // Excel sheet names: ≤31 chars, no : \ / ? * [ ], must be unique
    let base = (spec.name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
    let name = base, n = 2;
    while (usedNames.has(name.toLowerCase())) { name = `${base.slice(0, 28)} ${n++}`; }
    usedNames.add(name.toLowerCase());
    addSheet(wb, name, spec);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { buildWorkbook };
