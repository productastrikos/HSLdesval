import React, { useState, useEffect } from 'react';
import { downloadXlsx } from '../../services/featureApi';
import { listUserDocs, getUserDoc } from '../../services/docStore';

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
export function DocSource({ label, value, onChange }) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    const load = () => listUserDocs().then(setDocs).catch(() => setDocs([]));
    load();
    window.addEventListener('docstore:changed', load);
    return () => window.removeEventListener('docstore:changed', load);
  }, []);

  const onPick = async (id) => {
    if (!id) { onChange(null); return; }
    const d = await getUserDoc(id);
    if (d) onChange({ id: d.id, name: d.name, text: d.text });
  };

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold text-slate-300">{label}</label>
      {docs.length === 0 ? (
        <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">
          No documents yet — upload one on the <span className="text-sky-400">Documents</span> page.
        </div>
      ) : (
        <select
          value={value?.id || ''}
          onChange={(e) => onPick(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200"
        >
          <option value="">Select an uploaded document…</option>
          {docs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.type}</option>)}
        </select>
      )}
      {value && <div className="text-[10px] text-emerald-400">✓ {value.name}{value.text ? ` · ${(value.text.length / 1000).toFixed(0)}k chars` : ''}</div>}
    </div>
  );
}

/* ─── Result table with Excel export ─────────────────────────────────────── */
export function ResultTable({ columns, rows, title, downloadName = 'export', sheetName = 'Sheet1', extraSheets = [], note }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  const onDownload = async () => {
    setBusy(true); setErr(null);
    try {
      await downloadXlsx([{ name: sheetName, columns, rows, title }, ...extraSheets], downloadName);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (!columns?.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-400">{title} <span className="text-slate-500">· {rows.length} row{rows.length === 1 ? '' : 's'}</span></div>
        <button
          onClick={onDownload}
          disabled={busy || !rows.length}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
        >
          {busy ? <Spinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>}
          Download Excel
        </button>
      </div>
      <ErrorNote>{err}</ErrorNote>
      <div className="overflow-auto rounded-lg border border-app-border max-h-[60vh]">
        <table className="w-full text-[11px] border-collapse">
          <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.03] sticky top-0">
            <tr>{columns.map(c => <th key={c} className="text-left px-3 py-2 font-semibold whitespace-nowrap border-b border-app-border">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-white/[0.02] align-top">
                {columns.map(c => (
                  <td key={c} className="px-3 py-2 text-slate-300">
                    {PILL_COLS.test(c) && String(r[c] ?? '').trim() && String(r[c]).length < 24
                      ? <Pill value={String(r[c])}>{String(r[c])}</Pill>
                      : <span className="whitespace-pre-wrap break-words">{r[c] ?? ''}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
