import React, { useState, useEffect, useRef } from 'react';
import { downloadXlsx, downloadWord, downloadPdf, sendFeedback } from '../../services/featureApi';
import { chat } from '../../services/aiService';
import { listSelectableDocs, getSelectableDoc } from '../../services/docStore';

/* ─── Layout primitives ──────────────────────────────────────────────────── */
export function Page({ title, subtitle, children, actions }) {
  return (
    <div className="h-full overflow-y-auto p-1 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5 max-w-3xl leading-relaxed">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, desc, children, right, className = '' }) {
  return (
    <div className={`bg-app-panel border border-app-border rounded-xl p-5 space-y-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-bold text-white">{title}</h2>}
            {desc && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{desc}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatTile({ label, value, tone = 'sky' }) {
  const colors = {
    sky: 'text-sky-400', violet: 'text-violet-400', emerald: 'text-emerald-400',
    amber: 'text-amber-400', red: 'text-red-400', orange: 'text-orange-400', slate: 'text-slate-300',
  };
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${colors[tone] || colors.sky}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase mt-0.5 tracking-wide">{label}</div>
    </div>
  );
}

export function Spinner({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="text-[11px] text-red-300 bg-red-500/[0.07] border border-red-500/30 rounded-lg px-3 py-2">⚠ {children}</div>;
}

export function RunButton({ onClick, busy, disabled, children, busyLabel = 'Working…' }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full py-2.5 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
    >
      {busy ? (<><Spinner /> {busyLabel}</>) : children}
    </button>
  );
}

/* ─── Severity / status colour mapping ───────────────────────────────────── */
const TONE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high:     'bg-orange-500/15 text-orange-300 border-orange-500/30',
  medium:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low:      'bg-sky-500/15 text-sky-300 border-sky-500/30',
  info:     'bg-sky-500/15 text-sky-300 border-sky-500/30',
  // statuses
  complied:        'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  submitted:       'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'partially complied': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  partial:         'bg-amber-500/15 text-amber-300 border-amber-500/30',
  deviation:       'bg-orange-500/15 text-orange-300 border-orange-500/30',
  insufficient:    'bg-orange-500/15 text-orange-300 border-orange-500/30',
  exclusion:       'bg-red-500/15 text-red-300 border-red-500/30',
  'not addressed': 'bg-red-500/15 text-red-300 border-red-500/30',
  missing:         'bg-red-500/15 text-red-300 border-red-500/30',
  ambiguous:       'bg-violet-500/15 text-violet-300 border-violet-500/30',
  yes:             'bg-red-500/15 text-red-300 border-red-500/30',
  no:              'bg-slate-600/20 text-slate-300 border-slate-600/40',
};

export function Pill({ children, value }) {
  const key = String(value ?? children ?? '').toLowerCase();
  const cls = TONE[key] || 'bg-slate-600/20 text-slate-300 border-slate-600/40';
  return <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase whitespace-nowrap ${cls}`}>{children ?? value}</span>;
}

const PILL_COLS = /sever|status|risk|likeli|impact|recurring|priority|type|categ/i;

/* ─── Document source: pick one of the user's uploaded documents ──────────────
   Documents are uploaded once on the Documents page and persist (in the browser)
   for the rest of the session. Every feature selects from that shared list. */
export function DocSource({ label, value, onChange, filter }) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    const load = () => listSelectableDocs().then(all => setDocs(filter ? all.filter(filter) : all)).catch(() => setDocs([]));
    load();
    window.addEventListener('docstore:changed', load);
    return () => window.removeEventListener('docstore:changed', load);
  }, [filter]);

  const onPick = async (id) => {
    if (!id) { onChange(null); return; }
    const d = await getSelectableDoc(id);
    if (d) onChange({ id: d.id, name: d.name, text: d.text, libraryFile: d.libraryFile, source: d.source });
  };

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold text-slate-300">{label}</label>
      {docs.length === 0 ? (
        <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">
          No documents available — upload one on the <span className="text-sky-400">Documents</span> page.
        </div>
      ) : (
        <select
          value={value?.id || ''}
          onChange={(e) => onPick(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200"
        >
          <option value="">Select a document…</option>
          {docs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.type}</option>)}
        </select>
      )}
      {value && <div className="text-[10px] text-emerald-400">✓ {value.name}{value.text ? ` · ${(value.text.length / 1000).toFixed(0)}k chars` : ''}</div>}
    </div>
  );
}

/* ─── Multi document source: select several documents at once ──────────────── */
export function MultiDocSource({ label, values = [], onChange, filter }) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    const load = () => listSelectableDocs().then(all => setDocs(filter ? all.filter(filter) : all)).catch(() => setDocs([]));
    load();
    window.addEventListener('docstore:changed', load);
    return () => window.removeEventListener('docstore:changed', load);
  }, [filter]);

  const toggle = async (id, on) => {
    if (on) {
      const d = await getSelectableDoc(id);
      if (d) onChange([...values, { id: d.id, name: d.name, text: d.text, libraryFile: d.libraryFile, source: d.source }]);
    } else {
      onChange(values.filter(v => v.id !== id));
    }
  };

  const selectAll = async () => {
    const missing = docs.filter(d => !values.some(v => v.id === d.id));
    const loaded = (await Promise.all(missing.map(d => getSelectableDoc(d.id)))).filter(Boolean)
      .map(d => ({ id: d.id, name: d.name, text: d.text, libraryFile: d.libraryFile, source: d.source }));
    onChange([...values, ...loaded]);
  };
  const clearAll = () => onChange([]);
  const allSelected = docs.length > 0 && docs.every(d => values.some(v => v.id === d.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold text-slate-300">{label}</label>
        {docs.length > 0 && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={selectAll} disabled={allSelected}
              className="text-[10px] font-semibold text-sky-300 hover:text-sky-200 disabled:opacity-40">Select all</button>
            <span className="text-slate-600">·</span>
            <button type="button" onClick={clearAll} disabled={!values.length}
              className="text-[10px] font-semibold text-slate-400 hover:text-white disabled:opacity-40">Clear</button>
          </div>
        )}
      </div>
      {docs.length === 0 ? (
        <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">
          No documents available — upload one on the <span className="text-sky-400">Documents</span> page.
        </div>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-lg bg-slate-900 border border-slate-700 divide-y divide-white/[0.05]">
          {docs.map(d => {
            const on = values.some(v => v.id === d.id);
            return (
              <label key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-200 cursor-pointer hover:bg-white/[0.03]">
                <input type="checkbox" checked={on} onChange={e => toggle(d.id, e.target.checked)} className="accent-sky-500" />
                <span className="truncate flex-1">{d.name}</span>
                <span className="text-[9px] text-slate-500 shrink-0">{d.type}{d.source === 'library' ? ' · lib' : ''}</span>
              </label>
            );
          })}
        </div>
      )}
      {values.length > 0 && <div className="text-[10px] text-emerald-400">✓ {values.length} selected</div>}
    </div>
  );
}

/* ─── Tabular helpers: copy-paste into Excel (TSV) & editable column lists ─── */
export function rowsToTSV(columns, rows) {
  const clean = v => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  const head = columns.join('\t');
  const body = (rows || []).map(r => columns.map(c => clean(r[c])).join('\t')).join('\n');
  return body ? `${head}\n${body}` : head;
}

// Copies the table as tab-separated text so it pastes straight into Excel/Sheets
// and autofills across cells (the Gemini/ChatGPT "copy table" behaviour).
export function CopyExcelButton({ columns, rows, label = 'Copy for Excel' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rowsToTSV(columns, rows));
      setDone(true); setTimeout(() => setDone(false), 1500);
    } catch (_) { /* clipboard blocked */ }
  };
  return (
    <button onClick={copy} type="button"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/30 text-[11px] font-semibold hover:bg-violet-500/25 transition-colors">
      {done ? '✓ Copied' : label}
    </button>
  );
}

// Editable list of output columns — lets the user adjust the table format BEFORE
// running extraction. Backed by a plain string[] so the result table reuses it.
export function EditableColumns({ columns = [], onChange, label = 'Output columns (edit before extracting)' }) {
  const setAt = (i, v) => { const c = [...columns]; c[i] = v; onChange(c); };
  const add   = () => onChange([...columns, '']);
  const del   = (i) => onChange(columns.filter((_, j) => j !== i));
  return (
    <div className="space-y-1">
      {label && <label className="text-[11px] font-semibold text-slate-300">{label}</label>}
      <div className="flex flex-wrap gap-1.5">
        {columns.map((c, i) => (
          <span key={i} className="flex items-center rounded-lg bg-slate-900 border border-slate-700 pl-2">
            <input value={c} onChange={e => setAt(i, e.target.value)} placeholder="column"
              className="bg-transparent text-[11px] text-slate-200 py-1 w-32 outline-none" />
            <button type="button" onClick={() => del(i)} className="px-1.5 text-slate-500 hover:text-red-300">×</button>
          </span>
        ))}
        <button type="button" onClick={add}
          className="px-2.5 py-1 rounded-lg border border-dashed border-slate-600 text-[11px] text-slate-400 hover:text-sky-300 hover:border-sky-500/40">+ Add column</button>
      </div>
    </div>
  );
}

/* ─── Markdown-table parsing + rich text (renders | a | b | tables) ────────── */
function splitCells(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(s => s.trim());
}
function parseMarkdownTable(lines) {
  if (lines.length < 2) return null;
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1]) || !lines[1].includes('-')) return null;
  const cols = splitCells(lines[0]);
  const rows = lines.slice(2).map(l => { const cs = splitCells(l); const o = {}; cols.forEach((c, i) => { o[c] = cs[i] ?? ''; }); return o; });
  return { columns: cols, rows };
}
// Render assistant text, turning contiguous "| … |" blocks into HTML tables with
// a Copy-for-Excel button. Falls back to the lightweight inline markdown styling.
export function RichText({ text }) {
  const lines = (text || '').split('\n');
  const blocks = [];
  let buf = [];
  const flush = () => { if (buf.length) { blocks.push({ type: 'text', lines: buf }); buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const isTableLine = /\|.*\|/.test(lines[i]);
    if (isTableLine) {
      const tbl = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { tbl.push(lines[i]); i++; }
      i--;
      const parsed = parseMarkdownTable(tbl);
      if (parsed && parsed.columns.length) { flush(); blocks.push({ type: 'table', ...parsed }); }
      else buf.push(...tbl);
    } else buf.push(lines[i]);
  }
  flush();
  return (
    <div className="text-[12px] leading-relaxed text-slate-200 space-y-2">
      {blocks.map((b, bi) => b.type === 'table'
        ? (
          <div key={bi} className="space-y-1">
            <div className="overflow-auto rounded-lg border border-app-border max-h-80">
              <table className="w-full text-[11px] border-collapse">
                <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.03] sticky top-0">
                  <tr>{b.columns.map((c, j) => <th key={j} className="text-left px-3 py-1.5 font-semibold whitespace-nowrap border-b border-app-border">{c}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {b.rows.map((r, ri) => <tr key={ri}>{b.columns.map((c, ci) => <td key={ci} className="px-3 py-1.5 text-slate-300 whitespace-pre-wrap break-words">{r[c]}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
            <CopyExcelButton columns={b.columns} rows={b.rows} />
          </div>
        )
        : (
          <div key={bi} className="space-y-1">
            {b.lines.map((line, i) => {
              if (!line.trim()) return null;
              if (/^#{1,3}\s/.test(line)) return <p key={i} className="font-bold text-white">{line.replace(/^#{1,3}\s/, '')}</p>;
              if (/^\s*[-*•]\s/.test(line)) return <p key={i} className="pl-3">· {line.replace(/^\s*[-*•]\s/, '')}</p>;
              const parts = line.split(/(\*\*[^*]+\*\*)/g);
              return <p key={i}>{parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
                ? <strong key={j} className="text-white font-semibold">{p.slice(2, -2)}</strong> : p)}</p>;
            })}
          </div>
        ))}
    </div>
  );
}

/* ─── Result table with Excel export (+ optional inline editing) ──────────── */
export function ResultTable({ columns, rows, title, downloadName = 'export', sheetName = 'Sheet1', extraSheets = [], note, enableWord = true, enablePdf = true, editable = false, onRowsChange, onColumnsChange }) {
  const [busy, setBusy] = useState(false);
  const [wbusy, setWbusy] = useState(false);
  const [pbusy, setPbusy] = useState(false);
  const [err, setErr]   = useState(null);

  const editCell = (ri, col, v) => { if (!onRowsChange) return; const next = rows.map((r, i) => i === ri ? { ...r, [col]: v } : r); onRowsChange(next); };
  const addRow   = () => { if (!onRowsChange) return; const blank = {}; columns.forEach(c => { blank[c] = ''; }); onRowsChange([...rows, blank]); };
  const delRow   = (ri) => { if (!onRowsChange) return; onRowsChange(rows.filter((_, i) => i !== ri)); };
  const renameCol = (idx, name) => { if (!onColumnsChange) return; const next = [...columns]; next[idx] = name; onColumnsChange(next); };

  const onDownload = async () => {
    setBusy(true); setErr(null);
    try {
      await downloadXlsx([{ name: sheetName, columns, rows, title }, ...extraSheets], downloadName);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const onWord = async () => {
    setWbusy(true); setErr(null);
    try {
      await downloadWord({ title: title || sheetName, columns, rows, filename: downloadName });
    } catch (e) { setErr(e.message); }
    setWbusy(false);
  };

  const onPdf = async () => {
    setPbusy(true); setErr(null);
    try {
      await downloadPdf({ title: title || sheetName, columns, rows, filename: downloadName });
    } catch (e) { setErr(e.message); }
    setPbusy(false);
  };

  if (!columns?.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] text-slate-400">{title} <span className="text-slate-500">· {rows.length} row{rows.length === 1 ? '' : 's'}</span></div>
        <div className="flex items-center gap-2 flex-wrap">
          <CopyExcelButton columns={columns} rows={rows} />
          <button
            onClick={onDownload}
            disabled={busy || !rows.length}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
          >
            {busy ? <Spinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>}
            Excel
          </button>
          {enableWord && (
            <button
              onClick={onWord}
              disabled={wbusy || !rows.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold hover:bg-sky-500/25 transition-colors disabled:opacity-40"
            >
              {wbusy ? <Spinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
              Word
            </button>
          )}
          {enablePdf && (
            <button
              onClick={onPdf}
              disabled={pbusy || !rows.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-40"
            >
              {pbusy ? <Spinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
              PDF
            </button>
          )}
        </div>
      </div>
      <ErrorNote>{err}</ErrorNote>
      <div className="overflow-auto rounded-lg border border-app-border max-h-[60vh]">
        <table className="w-full text-[11px] border-collapse">
          <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.03] sticky top-0">
            <tr>
              {columns.map((c, ci) => (
                <th key={ci} className="text-left px-3 py-2 font-semibold whitespace-nowrap border-b border-app-border">
                  {editable && onColumnsChange
                    ? <input value={c} onChange={e => renameCol(ci, e.target.value)} className="bg-transparent text-slate-300 uppercase outline-none w-28" />
                    : c}
                </th>
              ))}
              {editable && <th className="border-b border-app-border w-8" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-white/[0.02] align-top">
                {columns.map(c => (
                  <td key={c} className="px-3 py-2 text-slate-300">
                    {editable
                      ? <textarea value={r[c] ?? ''} onChange={e => editCell(i, c, e.target.value)} rows={1}
                          className="w-full min-w-[7rem] bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 resize-y" />
                      : (PILL_COLS.test(c) && String(r[c] ?? '').trim() && String(r[c]).length < 24
                        ? <Pill value={String(r[c])}>{String(r[c])}</Pill>
                        : <span className="whitespace-pre-wrap break-words">{r[c] ?? ''}</span>)}
                  </td>
                ))}
                {editable && (
                  <td className="px-2 py-2 text-center">
                    <button type="button" onClick={() => delRow(i)} className="text-slate-500 hover:text-red-300" title="Delete row">×</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <button type="button" onClick={addRow}
          className="px-2.5 py-1 rounded-lg border border-dashed border-slate-600 text-[11px] text-slate-400 hover:text-sky-300 hover:border-sky-500/40">+ Add row</button>
      )}
      {note && <div className="text-[10px] text-slate-500">{note}</div>}
    </div>
  );
}

/* Text input + textarea helpers */
export function Field({ label, value, onChange, placeholder, textarea, rows = 3 }) {
  return (
    <div className="space-y-1">
      {label && <label className="text-[11px] font-semibold text-slate-300">{label}</label>}
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-600 resize-y" />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-600" />
      )}
    </div>
  );
}

/* ─── Continuous-learning feedback bar (shown under every AI output) ───────── */
export function FeedbackBar({ module, subject = '' }) {
  // HSL MVP item 16: Satisfied / Partially Satisfied / Not Satisfied + comments.
  const [state, setState]     = useState('idle');   // idle | remarks | sent
  const [rating, setRating]   = useState(null);     // satisfied | partially_satisfied | not_satisfied
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy]       = useState(false);

  const submit = async (r, note = '') => {
    setBusy(true);
    try { await sendFeedback({ module, rating: r, remarks: note, subject }); } catch (_) {}
    setBusy(false); setState('sent');
  };

  const pick = (r) => {
    setRating(r);
    if (r === 'satisfied') submit('satisfied');     // no comment needed for full satisfaction
    else setState('remarks');                       // ask for comments on partial / not satisfied
  };

  const RATING_LABEL = { partially_satisfied: 'Partially Satisfied', not_satisfied: 'Not Satisfied' };

  if (state === 'sent') {
    return <div className="text-[10px] text-emerald-400 flex items-center gap-1.5 pt-1">✓ Thank you — feedback recorded; it will guide future results in this module.</div>;
  }

  return (
    <div className="pt-2 mt-1 border-t border-app-border space-y-2">
      {state === 'idle' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Rate this output</span>
          <button onClick={() => pick('satisfied')} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold hover:bg-emerald-500/25 disabled:opacity-40">
            🙂 Satisfied
          </button>
          <button onClick={() => pick('partially_satisfied')} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold hover:bg-amber-500/25 disabled:opacity-40">
            😐 Partially Satisfied
          </button>
          <button onClick={() => pick('not_satisfied')} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[10px] font-semibold hover:bg-red-500/25 disabled:opacity-40">
            🙁 Not Satisfied
          </button>
        </div>
      )}
      {state === 'remarks' && (
        <div className="space-y-2">
          <div className="text-[10px] text-slate-400">Selected: <span className="font-semibold text-slate-200">{RATING_LABEL[rating]}</span> — add a comment, suggestion or correction (used to improve future results).</div>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
            placeholder="What was wrong or what should change? (optional)"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-600 resize-y" />
          <div className="flex items-center gap-2">
            <button onClick={() => submit(rating, remarks)} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-semibold hover:bg-sky-500/25 disabled:opacity-40 flex items-center gap-1.5">
              {busy ? <Spinner /> : null} Submit feedback
            </button>
            <button onClick={() => { setState('idle'); setRemarks(''); }} className="px-3 py-1.5 rounded-lg text-[10px] text-slate-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Per-module chat assistant (prompt-driven, document-aware) ────────────── */
export function ModuleChat({ module, title = 'Ask the Assistant', docText, docName, suggestions = [], placeholder }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    const history = [...messages, { role: 'user', content: q }];
    setMessages(history);
    setBusy(true);
    try {
      const resp = await chat(history.map(m => ({ role: m.role, content: m.content })), undefined, docText, docName, title || module);
      setMessages(h => [...h, { role: 'assistant', content: resp.content, citations: resp.citations || [] }]);
    } catch (e) {
      setMessages(h => [...h, { role: 'assistant', content: `⚠ ${e.message}`, error: true }]);
    }
    setBusy(false);
  };

  return (
    <Card title={title} desc={docName ? `Context: ${docName}` : 'Ask anything in the context of this module — grounded in the HSL knowledge base.'}>
      {suggestions.length > 0 && messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => send(s)} disabled={busy}
              className="text-left text-[10px] px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-app-border hover:bg-sky-500/[0.06] hover:border-sky-500/30 text-slate-300 disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
      )}
      {messages.length > 0 && (
        <div className="max-h-72 overflow-y-auto space-y-3 rounded-lg bg-slate-950/30 border border-app-border p-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0 ${m.role === 'user' ? 'bg-slate-700 text-slate-200' : 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white'}`}>{m.role === 'user' ? 'U' : 'AI'}</div>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-slate-700/50' : m.error ? 'bg-red-500/10 border border-red-500/30' : 'bg-app-panel border border-app-border'}`}>
                <RichText text={m.content} />
                {m.citations?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.citations.map((c, j) => <span key={j} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">{c}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Thinking…</div>}
          <div ref={endRef} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder={placeholder || 'Ask a question about this module…'}
          className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[12px] text-slate-200 placeholder-slate-600 resize-none max-h-28"
        />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-[11px] font-semibold disabled:opacity-40 hover:opacity-90">Send</button>
      </div>
    </Card>
  );
}
