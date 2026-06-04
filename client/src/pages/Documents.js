import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { compareDocs } from '../services/hslKnowledge';
import { uploadDocument, compareByIds, listDocuments, validate, isConfigured, deleteDocument } from '../services/aiService';
import { useAuth } from '../context/AuthContext';

// ── Document type styles ──────────────────────────────────────────────────────
const TYPE_COLOR = {
  // Knowledge-base (compliance) types — static, not user-uploadable
  'Class Rule':      'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'IACS':            'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'IMO':             'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'IEC':             'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Naval':           'bg-red-500/15 text-red-300 border-red-500/30',
  'Build Spec':      'bg-violet-500/15 text-violet-300 border-violet-500/30',
  // User-uploadable document types
  'SOTR':            'bg-orange-500/15 text-orange-300 border-orange-500/30',
  'Technical Offer': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'Binding Data':    'bg-teal-500/15 text-teal-300 border-teal-500/30',
};

// All 3 upload types are available to both admin and regular users
const UPLOAD_DOC_TYPES = ['SOTR', 'Technical Offer', 'Binding Data'];
const ADMIN_DOC_TYPES  = UPLOAD_DOC_TYPES;
const USER_DOC_TYPES   = UPLOAD_DOC_TYPES;
const COMPLIANCE_TYPES = new Set(['Class Rule', 'IACS', 'IMO', 'IEC', 'Naval', 'Build Spec']);

// ── Validator helpers ─────────────────────────────────────────────────────────
function staticFindingsFor() {
  return [];
}

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

function UploadCard({ onAdd, aiMode, userRole }) {
  const TYPES = userRole === 'admin' ? ADMIN_DOC_TYPES : USER_DOC_TYPES;

  const [stage,    setStage]    = useState('idle');
  const [progress, setProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState(null);
  const [error,    setError]    = useState(null);
  const [docType,  setDocType]  = useState(TYPES[0]);
  const fileRef = useRef(null);

  const start = async (file) => {
    setFileInfo({ name: file.name, size: file.size });
    setError(null);

    if (aiMode) {
      setStage('reading'); setProgress(20);
      try {
        setStage('ocr'); setProgress(50);
        const result = await uploadDocument(file, docType, file.name);
        setStage('indexing'); setProgress(80);
        await new Promise(r => setTimeout(r, 400));
        setStage('done'); setProgress(100);
        onAdd && onAdd({
          id:         result.docId,
          name:       result.name,
          type:       result.type || docType,
          pages:      result.pages || Math.ceil((result.textLength || 0) / 3000),
          ocr:        file.name.match(/\.(jpg|jpeg|png|tiff?)$/i) ? true : false,
          status:     'indexed',
          confidence: 98.5,
          backendId:  result.docId,
        });
      } catch (e) {
        setError(e.message);
        setStage('error');
      }
    } else {
      const tick = (next, msFor, after) => {
        const t0 = Date.now();
        const itv = setInterval(() => {
          const p = Math.min(100, ((Date.now() - t0) / msFor) * 100);
          setProgress(Math.floor(p));
          if (p >= 100) { clearInterval(itv); after && after(); }
        }, 60);
      };
      setStage('reading'); setProgress(0);
      tick(null, 800, () => {
        setStage('ocr'); setProgress(0);
        tick(null, 1400, () => {
          setStage('indexing'); setProgress(0);
          tick(null, 900, () => {
            setStage('done'); setProgress(100);
            onAdd && onAdd({
              id:         'DOC-' + (1000 + Math.floor(Math.random() * 900)),
              name:       file.name,
              type:       docType,
              pages:      Math.ceil(file.size / 4096) || 48,
              ocr:        true,
              status:     'indexed',
              confidence: 97.6,
            });
          });
        });
      });
    }
  };

  const onPick = (e) => { const f = e.target.files?.[0]; if (f) start(f); };

  const stageLabel = {
    idle:     userRole === 'admin'
      ? 'Drag a PDF, DOCX, or image here — or click to upload'
      : 'Upload SOTR, Technical Offer, or Binding Data documents (PDF, DOCX)',
    reading:  aiMode ? 'Reading file…' : 'Reading binary stream…',
    ocr:      aiMode ? 'Extracting text (PDF parse / OCR)…' : 'Running offline OCR…',
    indexing: aiMode ? 'Chunking and indexing into knowledge base…' : 'Generating embeddings and cross-references…',
    done:     aiMode ? 'Document indexed and available for RAG' : 'Document indexed and ready for query',
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
            <span className="text-[11px] text-slate-500">PDF · DOCX · scanned images · CSV · up to 200 MB</span>
          </button>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold shrink-0">Document Type:</label>
              <select
                value={docType}
                onChange={e => setDocType(e.target.value)}
                className="text-[11px] px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 flex-1"
              >
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={`text-[10px] px-2 py-1 rounded font-semibold border ${
              docType === 'SOTR'
                ? 'bg-orange-500/10 text-orange-300 border-orange-500/25'
                : docType === 'Technical Offer'
                ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25'
                : 'bg-teal-500/10 text-teal-300 border-teal-500/25'
            }`}>
              {docType === 'SOTR'
                ? 'Statement of Technical Requirements — navy/authority requirements specification'
                : docType === 'Technical Offer'
                ? 'Technical Offer — vendor offer and compliance matrix'
                : 'Binding Data — vendor-committed technical drawings and data sheets'}
            </div>
          </div>
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
              <button onClick={() => { setStage('idle'); setError(null); setFileInfo(null); }} className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Done · upload another</button>
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
              { k:'indexing', l:'3. Index' },
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
      const res = await fetch('/api/convert', {
        method:  'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
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
      <p className="text-[11px] text-slate-400 mb-3">Extract text from a PDF, DOCX, or scanned image and download as Excel, plain text, or Word.</p>
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

function ComparePanel({ allDocs, aiMode, navigate }) {
  const [docAId,  setDocAId]  = useState('');
  const [docBId,  setDocBId]  = useState('');
  const [diff,    setDiff]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const run = async () => {
    if (!aiMode) { setDiff(compareDocs()); return; }
    if (!docAId || !docBId) return;
    setLoading(true); setDiff(null); setError(null);
    try {
      const result = await compareByIds(docAId, docBId);
      if (result.diff && result.diff.length > 0) {
        setDiff(result.diff);
      } else {
        setError('AI returned no structured diff. Try selecting documents with differing content.');
      }
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
      <p className="text-[11px] text-slate-400 mb-3">
        {aiMode
          ? 'Select two documents from the KB — AI performs a detailed section-by-section diff'
          : 'Demo comparison — HSL-BS-21-411 Rev.B vs Rev.C (static example)'
        }
      </p>
      {aiMode && (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Document A</label>
            <select value={docAId} onChange={e => setDocAId(e.target.value)} className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
              <option value="">— select —</option>
              {allDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Document B</label>
            <select value={docBId} onChange={e => setDocBId(e.target.value)} className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
              <option value="">— select —</option>
              {allDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <button
        onClick={run}
        disabled={loading || (aiMode && (!docAId || !docBId))}
        className="w-full py-2 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {loading ? 'AI comparing…' : aiMode ? '✦ Compare with AI' : 'Run Demo Comparison'}
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
      {!aiMode && (
        <div className="mt-2 text-[10px] text-amber-400 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <button onClick={() => navigate('/settings')} className="underline hover:text-amber-300">Configure API key</button> for real AI comparison
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Documents() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userRole = user?.role || 'user';
  const isAdmin  = userRole === 'admin';
  const aiMode   = isConfigured();

  const [activeTab, setActiveTab] = useState('documents');

  // ─ Documents state ──────────────────────────────────────────────────────────
  const [docs,        setDocs]        = useState([]);
  const [backendDocs, setBackendDocs] = useState([]);
  const [docFilter,   setDocFilter]   = useState('All');
  const [query,       setQuery]       = useState('');
  const [deletingId,  setDeletingId]  = useState(null);

  const refreshBackendDocs = useCallback(async () => {
    try { const bd = await listDocuments(); setBackendDocs(bd); } catch (_) {}
  }, []);

  useEffect(() => { refreshBackendDocs(); }, [refreshBackendDocs]);

  const handleDelete = useCallback(async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"?\n\nThis will remove it from the knowledge base and it cannot be undone.`)) return;
    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id);
      await refreshBackendDocs();
    } catch (err) {
      window.alert(`Delete failed: ${err.message}`);
    }
    setDeletingId(null);
  }, [refreshBackendDocs]);

  const displayDocs = aiMode ? backendDocs.filter(d => d.uploadedBy !== 'system') : docs;
  const types       = ['All', ...Array.from(new Set(displayDocs.map(d => d.type)))];

  const filtered = useMemo(() => displayDocs.filter(d => {
    if (docFilter !== 'All' && d.type !== docFilter) return false;
    if (query && !d.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [displayDocs, docFilter, query]);

  const summary = useMemo(() => ({
    total:      displayDocs.length,
    pages:      displayDocs.reduce((s, d) => s + (d.pages || d.chunkCount || 0), 0),
    compliance: displayDocs.filter(d => d.docCategory === 'compliance' || COMPLIANCE_TYPES.has(d.type)).length,
    vendor:     displayDocs.filter(d => d.docCategory === 'vendor' || (!COMPLIANCE_TYPES.has(d.type) && d.docCategory !== 'system')).length,
  }), [displayDocs]);

  const allDocsForCompare = useMemo(() => backendDocs.map(d => ({ id: d.id, name: d.name })), [backendDocs]);

  // ─ Validator state ──────────────────────────────────────────────────────────
  const [selectedSpec, setSelectedSpec] = useState('');
  const [valFilter,    setValFilter]    = useState('all');
  const [running,      setRunning]      = useState(false);
  const [scanLog,      setScanLog]      = useState([]);
  const [aiFindings,   setAiFindings]   = useState(null);
  const [aiError,      setAiError]      = useState(null);

  const validatorDocs = useMemo(() => backendDocs.filter(d => d.uploadedBy !== 'system'), [backendDocs]);

  useEffect(() => {
    if (validatorDocs.length > 0 && !validatorDocs.find(d => d.id === selectedSpec)) {
      setSelectedSpec(validatorDocs[0].id);
    }
  }, [validatorDocs, selectedSpec]);

  const spec = validatorDocs.find(s => s.id === selectedSpec);

  const findings = useMemo(() => {
    if (aiFindings !== null) return aiFindings;
    return staticFindingsFor(spec);
  }, [aiFindings, spec]);

  const visible = useMemo(() => {
    if (valFilter === 'all') return findings;
    return findings.filter(f => f.severity === valFilter || f.status === valFilter);
  }, [findings, valFilter]);

  const counts = useMemo(() => ({
    critical: findings.filter(f => f.severity === 'critical').length,
    high:     findings.filter(f => f.severity === 'high').length,
    medium:   findings.filter(f => f.severity === 'medium').length,
    open:     findings.filter(f => f.status === 'open').length,
    resolved: findings.filter(f => f.status === 'resolved').length,
  }), [findings]);

  const score = useMemo(() => (
    Math.max(40, 100 + findings.reduce((s, f) => s + (f.status === 'resolved' ? 0 : (f.impact || 0)), 0))
  ), [findings]);

  const runScan = async () => {
    setRunning(true);
    setScanLog([]);
    setAiFindings(null);
    setAiError(null);

    const docPages = spec?.pages || spec?.chunkCount || 200;
    const steps = aiMode ? [
      `Loading document: ${spec?.name || selectedSpec}…`,
      `Domain: ${spec?.type || 'General'} — retrieving applicable rules from KB…`,
      `Running TF-IDF retrieval across ${docPages} pages…`,
      `Cross-referencing IRS / DNV / ABS / IACS clauses…`,
      `Checking IMO MARPOL & SOLAS applicability…`,
      `Verifying IEC 60092 series electrical clauses…`,
      `Sending to Gemini for compliance analysis…`,
      `Detecting inconsistencies and repetitive statements…`,
      `Computing compliance score…`,
      `Scan complete · AI findings ready`,
    ] : [
      `Loading document: ${spec?.name || selectedSpec}…`,
      `Tokenising ${docPages} pages…`,
      `Retrieving applicable rule corpus from KB…`,
      `Cross-referencing IRS / DNV / ABS / IACS clauses…`,
      `Checking IMO MARPOL & SOLAS applicability…`,
      `Verifying IEC 60092 series electrical clauses…`,
      `Detecting inconsistencies and repetitive statements…`,
      `Computing compliance score…`,
      `Scan complete · findings ready`,
    ];

    steps.forEach((s, i) => setTimeout(() => setScanLog(prev => [...prev, s]), i * 320));

    if (aiMode) {
      try {
        const result = await validate(selectedSpec, spec?.type, `Document: ${spec?.name}`);
        if (result.findings && result.findings.length > 0) {
          setAiFindings(result.findings);
        } else {
          setAiError('AI returned no structured findings. Showing raw analysis in log.');
          if (result.rawAnalysis) {
            setScanLog(prev => [...prev, '─── AI Analysis ───', ...result.rawAnalysis.split('\n').slice(0, 8)]);
          }
        }
      } catch (e) {
        setAiError(e.message);
        setScanLog(prev => [...prev, `⚠ AI error: ${e.message}`]);
      }
    }

    setTimeout(() => setRunning(false), steps.length * 320);
  };

  // ─ Tab button helper ─────────────────────────────────────────────────────────
  const tabCls = (tab) => `px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
    activeTab === tab
      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
      : 'text-slate-400 hover:text-white border-transparent'
  }`;

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Document Intelligence</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {isAdmin
            ? 'Upload compliance & vendor documents · AI extraction · comparison · rule validation'
            : 'Upload vendor design documents · validate against compliance rules · compare with AI'
          }
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-app-panel border border-app-border rounded-xl p-1 w-fit">
        <button className={tabCls('documents')} onClick={() => setActiveTab('documents')}>Documents</button>
        <button className={tabCls('validator')} onClick={() => setActiveTab('validator')}>Rule Validator</button>
      </div>

      {/* ── DOCUMENTS TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <>
          {/* Role badge */}
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-semibold ${
            isAdmin
              ? 'bg-violet-500/10 border-violet-500/30 text-violet-300'
              : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
          }`}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={isAdmin
                  ? 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
                  : 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
                } />
            </svg>
            {isAdmin ? 'Administrator — full document access' : 'Design Engineer — vendor documents only'}
          </div>

          {!isAdmin && (
            <div className="flex items-start gap-2 bg-amber-500/[0.06] border border-amber-500/25 rounded-lg px-3 py-2 text-[11px] text-amber-300">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>
                Upload procurement documents as <strong>SOTR</strong> (Statement of Technical Requirements),{' '}
                <strong>Technical Offer</strong> (vendor offer &amp; compliance matrix), or{' '}
                <strong>Binding Data</strong> (vendor-committed drawings &amp; data sheets).
              </span>
            </div>
          )}

          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label:'Indexed',            value:summary.total,                  color:'text-sky-400',    sub:'documents' },
              { label:'Compliance Docs',    value:summary.compliance,             color:'text-violet-400', sub:'guardrails & rules' },
              { label:'Procurement Docs',    value:summary.vendor,                 color:'text-teal-400',   sub:'SOTR · Offer · Binding' },
              { label:'Total Pages/Chunks', value:summary.pages.toLocaleString(), color:'text-amber-400',  sub:'indexed content' },
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
              <UploadCard
                aiMode={aiMode}
                userRole={userRole}
                onAdd={(d) => { setDocs(prev => [d, ...prev]); refreshBackendDocs(); }}
              />

              <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-app-border flex items-center gap-3 flex-wrap">
                  <h3 className="text-sm font-bold text-white">Indexed Documents</h3>
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
                          docFilter === t
                            ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
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
                        <th className="text-left px-3 py-2 font-bold">Type</th>
                        <th className="text-right px-3 py-2 font-bold">Pages</th>
                        {isAdmin && <th className="text-left px-3 py-2 font-bold">Uploaded By</th>}
                        <th className="text-center px-3 py-2 font-bold">OCR</th>
                        <th className="text-right px-3 py-2 font-bold">Confidence</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {filtered.map(d => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2">
                            <div className="font-mono text-[10px] text-slate-500">{d.id}</div>
                            <div className="text-slate-200 font-semibold leading-tight">{d.name}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest ${TYPE_COLOR[d.type] || 'bg-slate-700 text-slate-300 border-slate-600'}`}>{d.type}</span>
                          </td>
                          <td className="text-right px-3 py-2 text-slate-300 font-mono">{d.pages || d.chunkCount || '—'}</td>
                          {isAdmin && (
                            <td className="px-3 py-2">
                              {d.uploadedBy ? (
                                <span className={`text-[9px] px-1 py-0.5 rounded font-semibold border ${
                                  d.uploadedByRole === 'admin'
                                    ? 'bg-violet-500/10 text-violet-300 border-violet-500/25'
                                    : d.uploadedByRole === 'system'
                                    ? 'bg-slate-700 text-slate-400 border-slate-600'
                                    : 'bg-sky-500/10 text-sky-300 border-sky-500/25'
                                }`}>{d.uploadedBy}</span>
                              ) : <span className="text-slate-600">—</span>}
                            </td>
                          )}
                          <td className="text-center px-3 py-2">
                            {d.ocr
                              ? <span className="text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">Yes</span>
                              : <span className="text-[9px] text-slate-500">No</span>}
                          </td>
                          <td className="text-right px-3 py-2">
                            <span className={`font-mono text-[11px] ${
                              !d.confidence ? 'text-slate-500' :
                              d.confidence >= 99 ? 'text-emerald-400' :
                              d.confidence >= 97 ? 'text-amber-300' :
                              'text-orange-300'
                            }`}>
                              {d.confidence ? `${(d.confidence || 0).toFixed(1)}%` : '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {(isAdmin || d.uploadedBy === user?.username) && d.uploadedBy !== 'system' && (
                              <button
                                onClick={() => handleDelete(d)}
                                disabled={deletingId === d.id}
                                title="Delete document"
                                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                              >
                                {deletingId === d.id ? (
                                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                )}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={isAdmin ? 7 : 6} className="px-3 py-8 text-center text-slate-500 text-[11px]">
                            No documents match the current filter.
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
              <ComparePanel allDocs={allDocsForCompare} aiMode={aiMode} navigate={navigate} />
            </div>
          </div>
        </>
      )}

      {/* ── RULE VALIDATOR TAB ──────────────────────────────────────────────── */}
      {activeTab === 'validator' && (
        <>
          <p className="text-[11px] text-slate-400 -mt-2">
            {aiMode
              ? 'AI-powered compliance scan — Claude cross-references build specs against the knowledge base'
              : 'Automated cross-referencing of Build Specifications against Class · IMO · IEC · Naval rules (demo mode)'
            }
          </p>

          {!aiMode && (
            <div className="flex items-center gap-2 bg-amber-500/[0.08] border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Demo mode — findings are static examples.
              <button onClick={() => navigate('/settings')} className="font-bold underline hover:text-white">Configure API key →</button>
            </div>
          )}
          {aiError && (
            <div className="flex items-center gap-2 bg-red-500/[0.08] border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              AI validation error: {aiError}
            </div>
          )}

          {/* Spec selector + score */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="bg-app-panel border border-app-border rounded-xl p-4 lg:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                {validatorDocs.length === 0 ? (
                  <div className="flex-1 text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">
                    No documents uploaded yet. Upload a document in the Documents tab to validate it.
                  </div>
                ) : (
                  <select
                    value={selectedSpec}
                    onChange={e => { setSelectedSpec(e.target.value); setAiFindings(null); setScanLog([]); setAiError(null); }}
                    className="flex-1 text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono font-bold"
                  >
                    {validatorDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
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
                      {aiMode ? 'Run AI Validation Scan' : 'Run Validation Scan'}
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  { label:'Type',        value: spec?.type || '—' },
                  { label:'Pages',       value: spec?.pages || spec?.chunkCount || '—' },
                  { label:'Uploaded',    value: spec?.addedAt ? new Date(spec.addedAt).toLocaleDateString() : '—' },
                  { label:'Findings',    value: findings.length, className:'text-amber-400' },
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
                  {running && <div className="text-sky-400 animate-pulse">▸ {aiMode ? 'Claude analyzing…' : 'Processing…'}</div>}
                </div>
              )}
            </div>

            {/* Compliance score gauge */}
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
                  <span className="text-3xl font-bold text-white">{score}</span>
                  <span className="text-[10px] text-slate-500">/ 100</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 w-full text-center text-[10px]">
                <div><div className="font-bold text-red-400">{counts.critical}</div><div className="text-slate-500 uppercase">Critical</div></div>
                <div><div className="font-bold text-orange-400">{counts.high}</div><div className="text-slate-500 uppercase">High</div></div>
                <div><div className="font-bold text-emerald-400">{counts.resolved}</div><div className="text-slate-500 uppercase">Resolved</div></div>
              </div>
              {aiFindings !== null && (
                <div className="mt-2 text-[9px] text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  AI findings
                </div>
              )}
            </div>
          </div>

          {/* Findings + applicable rules */}
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
                        valFilter === f
                          ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                    >{f}</button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {visible.length === 0 ? (
                  <div className="text-center text-slate-500 text-[11px] py-8">
                    {aiFindings === null && scanLog.length === 0
                      ? 'Run a validation scan to see compliance findings.'
                      : 'No findings match the current filter.'
                    }
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
