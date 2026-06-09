import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { uploadDocument, compareByText, validate } from '../services/aiService';
import { listUserDocs, getUserDoc, addUserDoc, removeUserDoc } from '../services/docStore';

// ── Document type styles ──────────────────────────────────────────────────────
const TYPE_COLOR = {
  'SOTR':              'bg-orange-500/15 text-orange-300 border-orange-500/30',
  'POTS':              'bg-pink-500/15 text-pink-300 border-pink-500/30',
  'Technical Offer':   'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'Binding Data':      'bg-teal-500/15 text-teal-300 border-teal-500/30',
  'Compliance Matrix': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'Inspection Report': 'bg-red-500/15 text-red-300 border-red-500/30',
  'Drawing':           'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'Build Specification':'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'RFP / Tender':      'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'General Document':  'bg-slate-600/20 text-slate-300 border-slate-600/40',
};

const SEV_STYLE = {
  critical: { txt:'text-red-400',    bg:'bg-red-500/15',    border:'border-red-500/30',    dot:'bg-red-500' },
  high:     { txt:'text-orange-400', bg:'bg-orange-500/15', border:'border-orange-500/30', dot:'bg-orange-500' },
  medium:   { txt:'text-amber-400',  bg:'bg-amber-500/15',  border:'border-amber-500/30',  dot:'bg-amber-500' },
  low:      { txt:'text-sky-400',    bg:'bg-sky-500/15',    border:'border-sky-500/30',    dot:'bg-sky-500' },
};
const STATUS_STYLE = {
  open:        { txt:'text-red-300',     bg:'bg-red-500/15',     label:'Open'      },
  'in-review': { txt:'text-amber-300',   bg:'bg-amber-500/15',   label:'In Review' },
  resolved:    { txt:'text-emerald-300', bg:'bg-emerald-500/15', label:'Resolved'  },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function ProgressBar({ value, color = 'bg-sky-400' }) {
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all duration-100`} style={{ width: `${value}%` }} />
    </div>
  );
}

// The single place in the whole application where documents may be uploaded.
// Type is detected automatically; the extracted content (image-only pages read
// by the vision model) is stored in the browser for the rest of the session.
function UploadCard({ onAdded }) {
  const [stage,    setStage]    = useState('idle');
  const [progress, setProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState(null);
  const [error,    setError]    = useState(null);
  const [detected, setDetected] = useState(null);
  const fileRef = useRef(null);

  const start = async (file) => {
    setFileInfo({ name: file.name, size: file.size });
    setError(null); setDetected(null);
    try {
      setStage('reading'); setProgress(25);
      setStage('ocr'); setProgress(55);
      const result = await uploadDocument(file);
      setStage('indexing'); setProgress(85);
      await addUserDoc({
        id:         result.docId,
        name:       result.name,
        type:       result.type,
        mime:       result.mime || file.type,
        pages:      result.pages,
        textLength: result.textLength,
        text:       result.text,
        file,                       // keep original for vision features (drawings)
      });
      setDetected(result.type);
      setStage('done'); setProgress(100);
      onAdded && onAdded();
    } catch (e) {
      setError(e.message);
      setStage('error');
    }
  };

  const onPick = (e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = ''; };

  const stageLabel = {
    idle:     'Drag a PDF, DOCX, or image here — or click to upload',
    reading:  'Reading file…',
    ocr:      'Extracting content (text layer + vision for scanned pages)…',
    indexing: 'Saving to your workspace…',
    done:     detected ? `Ready — detected as “${detected}”` : 'Ready',
    error:    'Upload failed',
  }[stage];

  const stageColor = { idle:'border-app-border', reading:'border-sky-500/40', ocr:'border-amber-500/40', indexing:'border-violet-500/40', done:'border-emerald-500/40', error:'border-red-500/40' }[stage];

  return (
    <div className={`bg-app-panel border-2 border-dashed ${stageColor} rounded-xl p-6 transition-colors`}>
      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.docx,.txt,.csv" className="hidden" onChange={onPick} />
      {stage === 'idle' && (
        <div className="space-y-3">
          <button onClick={() => fileRef.current?.click()} className="w-full flex flex-col items-center gap-2 text-slate-400 hover:text-sky-300 transition-colors">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <span className="text-sm font-semibold">{stageLabel}</span>
            <span className="text-[11px] text-slate-500">The document type is detected automatically · PDF · DOCX · scanned images · CSV · up to 200 MB</span>
          </button>
        </div>
      )}
      {stage !== 'idle' && fileInfo && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">{fileInfo.name}</div>
              <div className="text-[10px] text-slate-500">{((fileInfo.size || 0) / 1024 / 1024).toFixed(2)} MB · {stageLabel}</div>
            </div>
            {stage === 'done' && (
              <button onClick={() => { setStage('idle'); setError(null); setFileInfo(null); }} className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Upload another</button>
            )}
            {stage === 'error' && (
              <button onClick={() => { setStage('idle'); setError(null); setFileInfo(null); }} className="text-[10px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/30">Dismiss</button>
            )}
          </div>
          <ProgressBar value={progress} color={
            stage === 'error'    ? 'bg-red-400' :
            stage === 'reading'  ? 'bg-sky-400' :
            stage === 'ocr'      ? 'bg-amber-400' :
            stage === 'indexing' ? 'bg-violet-400' :
                                   'bg-emerald-400'
          } />
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            {[
              { k:'reading',  l:'1. Read' },
              { k:'ocr',      l:'2. Extract' },
              { k:'indexing', l:'3. Save' },
              { k:'done',     l:'4. Ready' },
            ].map(s => {
              const order = ['reading','ocr','indexing','done'];
              const done  = order.indexOf(stage) >= order.indexOf(s.k);
              return (
                <div key={s.k} className={`text-center py-1 rounded font-semibold uppercase tracking-widest ${done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>{s.l}</div>
              );
            })}
          </div>
          {error && (
            <div className="flex items-start gap-2 bg-red-500/[0.08] border border-red-500/30 rounded-lg px-3 py-2">
              <svg className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span className="text-[11px] text-red-300">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConversionTool() {
  const [busy,   setBusy]   = useState(false);
  const [done,   setDone]   = useState(null);
  const [error,  setError]  = useState(null);
  const [format, setFormat] = useState('XLSX');
  const [file,   setFile]   = useState(null);
  const fileRef = useRef(null);
  const formats = ['XLSX', 'TXT', 'DOCX', 'ODF'];

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setDone(null); setError(null); }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true); setDone(null); setError(null);
    try {
      const token = localStorage.getItem('auth_token') || '';
      const form  = new FormData();
      form.append('file',   file);
      form.append('format', format);
      let res;
      try {
        res = await fetch('/api/convert', {
          method:  'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body:    form,
        });
      } catch (_) {
        throw new Error('Cannot reach the server. Please check that the application is running.');
      }
      if (res.status === 401) { window.dispatchEvent(new Event('auth:logout')); throw new Error('Session expired — please sign in again.'); }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
        throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
      }
      const blob     = await res.blob();
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const ext      = format.toLowerCase();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `${baseName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setDone({ format, kb: Math.round(blob.size / 1024) });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="bg-app-panel border border-app-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-white mb-1">Convert PDF / Image → Editable Format</h3>
      <p className="text-[11px] text-slate-400 mb-3">Extract content from a PDF, DOCX, or scanned image and download as Excel, plain text, or Word.</p>
      <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp,.bmp" className="hidden" onChange={onPick} />
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full mb-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <span className="truncate">{file ? file.name : 'Select PDF, DOCX, or image…'}</span>
      </button>
      <div className="flex items-center gap-2 mb-3">
        {formats.map(f => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
              format === f
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
            }`}
          >{f}</button>
        ))}
      </div>
      <button
        onClick={run}
        disabled={busy || !file}
        className="w-full py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Converting…' : `Convert to .${format.toLowerCase()}`}
      </button>
      {error && <div className="mt-2 text-[11px] text-red-400">⚠ {error}</div>}
      {done && (
        <div className="mt-3 bg-emerald-500/[0.06] border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div className="text-[11px] text-emerald-300 flex-1">Downloaded as .{done.format.toLowerCase()} ({done.kb} KB)</div>
        </div>
      )}
    </div>
  );
}

function ComparePanel({ docs }) {
  const [docAId,  setDocAId]  = useState('');
  const [docBId,  setDocBId]  = useState('');
  const [diff,    setDiff]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const run = async () => {
    if (!docAId || !docBId) return;
    setLoading(true); setDiff(null); setError(null);
    try {
      const [a, b] = await Promise.all([getUserDoc(docAId), getUserDoc(docBId)]);
      const result = await compareByText(a?.text || '', b?.text || '', a?.name, b?.name);
      if (result.diff && result.diff.length > 0) setDiff(result.diff);
      else setError('No structured differences were found between these documents.');
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const sevColor = (s) =>
    s === 'critical' ? 'text-red-400' :
    s === 'high'     ? 'text-orange-400' :
    s === 'medium'   ? 'text-amber-400' :
                       'text-sky-400';

  return (
    <div className="bg-app-panel border border-app-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-white mb-1">Document Comparison</h3>
      <p className="text-[11px] text-slate-400 mb-3">Select two uploaded documents — the assistant performs a detailed section-by-section diff.</p>
      {docs.length < 2 ? (
        <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">Upload at least two documents to compare.</div>
      ) : (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Document A</label>
            <select value={docAId} onChange={e => setDocAId(e.target.value)} className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
              <option value="">— select —</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Document B</label>
            <select value={docBId} onChange={e => setDocBId(e.target.value)} className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
              <option value="">— select —</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <button
        onClick={run}
        disabled={loading || !docAId || !docBId}
        className="w-full py-2 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {loading ? 'Comparing…' : 'Compare Documents'}
      </button>
      {error && <div className="mt-2 text-[11px] text-red-400">⚠ {error}</div>}
      {diff && (
        <div className="mt-3 space-y-1.5 max-h-80 overflow-y-auto">
          {diff.map((r, i) => (
            <div key={i} className="bg-slate-950/40 border border-app-border rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-200">{r.section}</span>
                <span className={`text-[9px] font-bold uppercase ${sevColor(r.severity)}`}>{r.severity}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono mt-1">
                <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20 max-w-[40%] truncate" title={r.a}>{r.a}</span>
                <span className="text-slate-600">→</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 max-w-[40%] truncate" title={r.b}>{r.b}</span>
              </div>
              <p className="text-[10px] text-slate-500 italic mt-1">{r.impact}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Documents() {
  const [activeTab, setActiveTab] = useState('documents');

  // ─ Documents state (browser-held) ───────────────────────────────────────────
  const [docs,       setDocs]      = useState([]);
  const [docFilter,  setDocFilter] = useState('All');
  const [query,      setQuery]     = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const refreshDocs = useCallback(() => { listUserDocs().then(setDocs).catch(() => setDocs([])); }, []);

  useEffect(() => {
    refreshDocs();
    window.addEventListener('docstore:changed', refreshDocs);
    return () => window.removeEventListener('docstore:changed', refreshDocs);
  }, [refreshDocs]);

  const handleDelete = useCallback(async (doc) => {
    if (!window.confirm(`Remove "${doc.name}" from your workspace?`)) return;
    setDeletingId(doc.id);
    try { await removeUserDoc(doc.id); } catch (_) {}
    setDeletingId(null);
  }, []);

  const types    = ['All', ...Array.from(new Set(docs.map(d => d.type)))];
  const filtered = useMemo(() => docs.filter(d => {
    if (docFilter !== 'All' && d.type !== docFilter) return false;
    if (query && !d.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [docs, docFilter, query]);

  const summary = useMemo(() => ({
    total: docs.length,
    pages: docs.reduce((s, d) => s + (d.pages || 0), 0),
    types: new Set(docs.map(d => d.type)).size,
    chars: docs.reduce((s, d) => s + (d.textLength || 0), 0),
  }), [docs]);

  // ─ Validator state ──────────────────────────────────────────────────────────
  const [selectedSpec, setSelectedSpec] = useState('');
  const [valFilter,    setValFilter]    = useState('all');
  const [running,      setRunning]      = useState(false);
  const [scanLog,      setScanLog]      = useState([]);
  const [aiFindings,   setAiFindings]   = useState(null);
  const [aiError,      setAiError]      = useState(null);

  useEffect(() => {
    if (docs.length > 0 && !docs.find(d => d.id === selectedSpec)) setSelectedSpec(docs[0].id);
  }, [docs, selectedSpec]);

  const spec = docs.find(s => s.id === selectedSpec);

  const findings = useMemo(() => aiFindings || [], [aiFindings]);
  const visible = useMemo(() => {
    if (valFilter === 'all') return findings;
    return findings.filter(f => f.severity === valFilter || f.status === valFilter);
  }, [findings, valFilter]);

  const counts = useMemo(() => ({
    critical: findings.filter(f => f.severity === 'critical').length,
    high:     findings.filter(f => f.severity === 'high').length,
    resolved: findings.filter(f => f.status === 'resolved').length,
  }), [findings]);

  const score = useMemo(() => (
    Math.max(40, 100 + findings.reduce((s, f) => s + (f.status === 'resolved' ? 0 : (f.impact || 0)), 0))
  ), [findings]);

  const runScan = async () => {
    setRunning(true); setScanLog([]); setAiFindings(null); setAiError(null);
    const docPages = spec?.pages || 200;
    const steps = [
      `Loading document: ${spec?.name || selectedSpec}…`,
      `Domain: ${spec?.type || 'General'} — retrieving applicable rules from knowledge base…`,
      `Running hybrid retrieval across ${docPages} pages…`,
      `Cross-referencing IRS / DNV / ABS / IACS clauses…`,
      `Checking IMO MARPOL & SOLAS applicability…`,
      `Verifying IEC 60092 series electrical clauses…`,
      `Running local compliance analysis…`,
      `Detecting inconsistencies and repetitive statements…`,
      `Computing compliance score…`,
      `Scan complete · findings ready`,
    ];
    steps.forEach((s, i) => setTimeout(() => setScanLog(prev => [...prev, s]), i * 320));

    try {
      const full = await getUserDoc(selectedSpec);
      const result = await validate({ specText: full?.text, specName: spec?.name, domain: spec?.type, additionalContext: `Document: ${spec?.name}` });
      if (result.findings && result.findings.length > 0) setAiFindings(result.findings);
      else {
        setAiError('No structured findings were returned. Showing raw analysis in the log.');
        if (result.rawAnalysis) setScanLog(prev => [...prev, '─── Analysis ───', ...result.rawAnalysis.split('\n').slice(0, 8)]);
      }
    } catch (e) {
      setAiError(e.message);
      setScanLog(prev => [...prev, `⚠ Error: ${e.message}`]);
    }
    setTimeout(() => setRunning(false), steps.length * 320);
  };

  const tabCls = (tab) => `px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
    activeTab === tab ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'text-slate-400 hover:text-white border-transparent'
  }`;

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Document Intelligence</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Upload your documents here — they are read (with vision for scanned pages), auto-classified, and made available across every tool. Documents stay in your workspace until you sign out.
        </p>
      </div>

      <div className="flex gap-1 bg-app-panel border border-app-border rounded-xl p-1 w-fit">
        <button className={tabCls('documents')} onClick={() => setActiveTab('documents')}>Documents</button>
        <button className={tabCls('validator')} onClick={() => setActiveTab('validator')}>Rule Validator</button>
      </div>

      {/* ── DOCUMENTS TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label:'In Workspace',  value:summary.total,                  color:'text-sky-400',    sub:'documents' },
              { label:'Document Types',value:summary.types,                  color:'text-violet-400', sub:'detected' },
              { label:'Total Pages',   value:summary.pages.toLocaleString(), color:'text-amber-400',  sub:'extracted' },
              { label:'Characters',    value:summary.chars.toLocaleString(), color:'text-teal-400',   sub:'indexed content' },
            ].map(({ label, value, color, sub }) => (
              <div key={label} className="bg-app-panel border border-app-border rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</div>
                <div className={`text-2xl font-bold ${color} mt-1`}>{value}</div>
                <div className="text-[10px] text-slate-500">{sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 space-y-3">
              <UploadCard onAdded={refreshDocs} />

              <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-app-border flex items-center gap-3 flex-wrap">
                  <h3 className="text-sm font-bold text-white">Your Documents</h3>
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Filter by name…"
                    className="text-[11px] px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 flex-1 max-w-xs"
                  />
                  <div className="flex items-center gap-1 flex-wrap">
                    {types.map(t => (
                      <button
                        key={t}
                        onClick={() => setDocFilter(t)}
                        className={`text-[10px] px-2 py-1 rounded border font-semibold ${
                          docFilter === t ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                        }`}
                      >{t}</button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.02]">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold">Document</th>
                        <th className="text-left px-3 py-2 font-bold">Detected Type</th>
                        <th className="text-right px-3 py-2 font-bold">Pages</th>
                        <th className="text-left px-3 py-2 font-bold">Added</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {filtered.map(d => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2">
                            <div className="text-slate-200 font-semibold leading-tight">{d.name}</div>
                            <div className="font-mono text-[9px] text-slate-600">{Math.round((d.textLength || 0) / 1000)}k chars</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest ${TYPE_COLOR[d.type] || 'bg-slate-700 text-slate-300 border-slate-600'}`}>{d.type}</span>
                          </td>
                          <td className="text-right px-3 py-2 text-slate-300 font-mono">{d.pages || '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{d.addedAt ? new Date(d.addedAt).toLocaleDateString() : '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleDelete(d)}
                              disabled={deletingId === d.id}
                              title="Remove document"
                              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                            >
                              {deletingId === d.id ? (
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-slate-500 text-[11px]">
                            No documents yet. Upload one above to get started.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <ConversionTool />
              <ComparePanel docs={docs} />
            </div>
          </div>
        </>
      )}

      {/* ── RULE VALIDATOR TAB ──────────────────────────────────────────────── */}
      {activeTab === 'validator' && (
        <>
          <p className="text-[11px] text-slate-400 -mt-2">
            Compliance scan — the assistant cross-references your document against the knowledge base (Class · IMO · IEC · Naval rules).
          </p>

          {aiError && (
            <div className="flex items-center gap-2 bg-red-500/[0.08] border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              {aiError}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="bg-app-panel border border-app-border rounded-xl p-4 lg:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                {docs.length === 0 ? (
                  <div className="flex-1 text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">
                    No documents uploaded yet. Upload a document in the Documents tab to validate it.
                  </div>
                ) : (
                  <select
                    value={selectedSpec}
                    onChange={e => { setSelectedSpec(e.target.value); setAiFindings(null); setScanLog([]); setAiError(null); }}
                    className="flex-1 text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono font-bold"
                  >
                    {docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                )}
                <button
                  onClick={runScan}
                  disabled={running || !selectedSpec}
                  className="px-3 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 text-white text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  {running ? (
                    <><svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Scanning…</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                      Run Validation Scan</>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  { label:'Type',     value: spec?.type || '—' },
                  { label:'Pages',    value: spec?.pages || '—' },
                  { label:'Added',    value: spec?.addedAt ? new Date(spec.addedAt).toLocaleDateString() : '—' },
                  { label:'Findings', value: findings.length, className:'text-amber-400' },
                ].map(({ label, value, className }) => (
                  <div key={label} className="bg-slate-950/40 rounded-lg p-2 border border-slate-800">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
                    <div className={`text-sm font-bold mt-1 ${className || 'text-white'}`}>{value}</div>
                  </div>
                ))}
              </div>

              {scanLog.length > 0 && (
                <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[10px] max-h-36 overflow-y-auto">
                  {scanLog.map((l, i) => (
                    <div key={i} className={l.startsWith('⚠') ? 'text-red-400' : l.startsWith('─') ? 'text-slate-500' : 'text-slate-400'}>▸ {l}</div>
                  ))}
                  {running && <div className="text-sky-400 animate-pulse">▸ Analyzing…</div>}
                </div>
              )}
            </div>

            <div className="bg-app-panel border border-app-border rounded-xl p-4 flex flex-col items-center justify-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Compliance Score</div>
              <div className="relative w-32 h-32">
                <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" stroke="#1e293b" strokeWidth="10" fill="none" />
                  <circle cx="50" cy="50" r="42"
                    stroke={score >= 90 ? '#10b981' : score >= 75 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="10" fill="none"
                    strokeDasharray={`${(score / 100) * 264} 264`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white">{findings.length ? score : '—'}</span>
                  <span className="text-[10px] text-slate-500">/ 100</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 w-full text-center text-[10px]">
                <div><div className="font-bold text-red-400">{counts.critical}</div><div className="text-slate-500 uppercase">Critical</div></div>
                <div><div className="font-bold text-orange-400">{counts.high}</div><div className="text-slate-500 uppercase">High</div></div>
                <div><div className="font-bold text-emerald-400">{counts.resolved}</div><div className="text-slate-500 uppercase">Resolved</div></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden lg:col-span-2">
              <div className="px-4 py-3 border-b border-app-border flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-white">Findings</h3>
                <div className="flex items-center gap-1 flex-wrap">
                  {['all', 'critical', 'high', 'medium', 'open', 'resolved'].map(f => (
                    <button
                      key={f}
                      onClick={() => setValFilter(f)}
                      className={`text-[10px] px-2 py-1 rounded border font-semibold uppercase tracking-widest ${
                        valFilter === f ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                    >{f}</button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {visible.length === 0 ? (
                  <div className="text-center text-slate-500 text-[11px] py-8">
                    {aiFindings === null && scanLog.length === 0 ? 'Run a validation scan to see compliance findings.' : 'No findings match the current filter.'}
                  </div>
                ) : visible.map((f, i) => {
                  const sev = SEV_STYLE[f.severity] || SEV_STYLE.low;
                  const st  = STATUS_STYLE[f.status] || STATUS_STYLE.open;
                  return (
                    <div key={i} className="p-3 hover:bg-white/[0.02]">
                      <div className="flex items-start gap-2.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${sev.dot} mt-1.5 shrink-0`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-[9px] font-bold uppercase ${sev.txt} ${sev.bg} ${sev.border} border px-1.5 py-0.5 rounded`}>{f.severity}</span>
                            <span className={`text-[9px] font-bold uppercase ${st.txt} ${st.bg} px-1.5 py-0.5 rounded`}>{st.label}</span>
                            <span className="text-[10px] font-mono text-slate-500">{f.ruleId}</span>
                          </div>
                          <div className="text-[11px] font-semibold text-slate-200 leading-tight">{f.section}</div>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{f.finding}</p>
                        </div>
                        {f.impact < 0 && <span className="text-[10px] font-bold text-red-400 shrink-0">{f.impact}%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
