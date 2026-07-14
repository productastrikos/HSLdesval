'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CSV builder — real, RFC-4180-compliant comma-separated values.
// Rows may be objects keyed by column label, or positional arrays.
//   toCsv(columns, rows)        → CSV string (CRLF line endings)
//   toCsvBuffer(columns, rows)  → Buffer with a UTF-8 BOM so Excel opens it with
//                                 the correct encoding (accents, °, ×, µ …)
// ─────────────────────────────────────────────────────────────────────────────

const BOM = '﻿';

function cell(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// Quote a field if it contains a comma, quote, or newline (RFC 4180 §2.6/2.7).
function escapeField(v) {
  const s = cell(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns = [], rows = []) {
  const header = columns.map(escapeField).join(',');
  const body = rows.map(row => {
    const vals = Array.isArray(row)
      ? columns.map((_, i) => row[i])
      : columns.map(c => row[c]);
    return vals.map(escapeField).join(',');
  });
  return [header, ...body].join('\r\n');
}

function toCsvBuffer(columns = [], rows = []) {
  return Buffer.from(BOM + toCsv(columns, rows), 'utf8');
}

module.exports = { toCsv, toCsvBuffer };
