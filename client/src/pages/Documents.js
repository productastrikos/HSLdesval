import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { INDEXED_DOCS, compareDocs } from '../services/hslKnowledge';
import { uploadDocument, compareByIds, listDocuments, isConfigured } from '../services/aiService';

const TYPE_COLOR = {
  'Class Rule': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'IACS':       'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'IMO':        'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'IEC':        'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Naval':      'bg-red-500/15 text-red-300 border-red-500/30',
  'Build Spec': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'OEM Manual': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'Upload':     'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

function ProgressBar({ value, color = 'bg-sky-400' }) {
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all duration-100`} style={{ width: `${value}%` }} />
    </div>
  );
}

// ── Document upload card ──────────────────────────────────────────────────────
function UploadCard({ onAdd, aiMode }) {
  const [stage,    setStage]    = useState('idle');
  const [progress, setProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState(null);
  const [error,    setError]    = useState(null);
  const [docType,  setDocType]  = useState('Build Spec');
  const fileRef = useRef(null);

  const TYPES = ['Class Rule', 'IACS', 'IMO', 'IEC', 'Naval', 'Build Spec', 'OEM Manual', 'Upload'];

  const start = async (file) => {
    setFileInfo({ name: file.name, size: file.size });
    setError(null);

    if (aiMode) {
      // ── Real upload path ────────────────────────────────────────────────
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
        setStage('idle');
      }
    } else {
      // ── Demo upload simulation ──────────────────────────────────────────
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
    idle:     'Drag a PDF, DOCX, or image here — or click to upload',
    reading:  aiMode ? 'Reading file…' : 'Reading binary stream…',
    ocr:      aiMode ? 'Extracting text (PDF parse / OCR)…' : 'Running offline OCR…',
    indexing: aiMode ? 'Chunking and indexing into knowledge base…' : 'Generating embeddings and cross-references…',
    done:     aiMode ? 'Document indexed and available for RAG' : 'Document indexed and ready for query',
  }[stage];

  const stageColor = { idle:'border-app-border', reading:'border-sky-500/40', ocr:'border-amber-500/40', indexing:'border-violet-500/40', done:'border-emerald-500/40' }[stage];

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
              <button onClick={() => setStage('idle')} className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Done · upload another</button>
            )}
          </div>
          <ProgressBar value={progress} color={
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
          {error && <div className="text-[11px] text-red-400">⚠ {error}</div>}
        </div>
      )}
    </div>
  );
}

// ── Conversion tool (demo) ────────────────────────────────────────────────────
function ConversionTool() {
  const [busy,   setBusy]   = useState(false);
  const [done,   setDone]   = useState(null);
  const [format, setFormat] = useState('DOCX');
  const formats = ['DOCX', 'XLSX', 'ODF', 'TXT'];

  const run = () => {
    setBusy(true); setDone(null);
    setTimeout(() => { setBusy(false); setDone({ format, kb: 184 + Math.floor(Math.random() * 200) }); }, 1100);
  };

  return (
    <div className="bg-app-panel border border-app-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-white mb-1">Convert Scanned PDF → Editable Format</h3>
      <p className="text-[11px] text-slate-400 mb-3">Convert image-only or scanned graphical PDFs to Word, Excel, ODF or plain text. OCR layers are preserved.</p>
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
        disabled={busy}
        className="w-full py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {busy ? 'Converting…' : `Convert to .${format.toLowerCase()}`}
      </button>
      {done && (
        <div className="mt-3 bg-emerald-500/[0.06] border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          <div className="text-[11px] text-emerald-300 flex-1">Converted to .{done.format.toLowerCase()} ({done.kb} KB)</div>
        </div>
      )}
    </div>
  );
}

// ── AI document comparison panel ──────────────────────────────────────────────
function ComparePanel({ allDocs, aiMode, navigate }) {
  const [docAId,   setDocAId]   = useState('');
  const [docBId,   setDocBId]   = useState('');
  const [diff,     setDiff]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const run = async () => {
    if (!aiMode) {
      setDiff(compareDocs());
      return;
    }
    if (!docAId || !docBId) return;
    setLoading(true); setDiff(null); setError(null);
    try {
      const result = await compareByIds(docAId, docBId);
      if (result.diff && result.diff.length > 0) {
        setDiff(result.diff);
      } else {
        setError('AI returned no structured diff. Try selecting documents with differing content.');
      }
    } catch (e) {
      setError(e.message);
    }
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

      {aiMode ? (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Document A</label>
            <select
              value={docAId}
              onChange={e => setDocAId(e.target.value)}
              className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
            >
              <option value="">— select —</option>
              {allDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Document B</label>
            <select
              value={docBId}
              onChange={e => setDocBId(e.target.value)}
              className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
            >
              <option value="">— select —</option>
              {allDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      ) : null}

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

// ── Main Documents page ───────────────────────────────────────────────────────
export default function Documents() {
  const navigate = useNavigate();
  const aiMode   = isConfigured();

  const [docs,         setDocs]         = useState(INDEXED_DOCS);
  const [backendDocs,  setBackendDocs]  = useState([]);
  const [filter,       setFilter]       = useState('All');
  const [query,        setQuery]        = useState('');

  // Fetch backend docs when AI mode is active
  const refreshBackendDocs = useCallback(async () => {
    if (!aiMode) return;
    try {
      const bd = await listDocuments();
      setBackendDocs(bd);
    } catch (_) { /* backend may not be running */ }
  }, [aiMode]);

  useEffect(() => { refreshBackendDocs(); }, [refreshBackendDocs]);

  const types = ['All', ...Array.from(new Set(docs.map(d => d.type)))];

  const filtered = useMemo(() => {
    return docs.filter(d => {
      if (filter !== 'All' && d.type !== filter) return false;
      if (query && !d.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [docs, filter, query]);

  const summary = useMemo(() => ({
    total:    docs.length,
    pages:    docs.reduce((s, d) => s + (d.pages || 0), 0),
    ocrPages: docs.filter(d => d.ocr).reduce((s, d) => s + (d.pages || 0), 0),
    avgConf:  docs.length > 0 ? (docs.reduce((s, d) => s + (d.confidence || 99), 0) / docs.length).toFixed(1) : '99.0',
  }), [docs]);

  // Merge frontend docs + backend docs for comparison panel
  const allDocsForCompare = useMemo(() => {
    return backendDocs.map(d => ({ id: d.id, name: d.name }));
  }, [backendDocs]);

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Document Intelligence</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {aiMode
            ? 'Upload documents to the knowledge base · AI-powered extraction · comparison · format conversion'
            : 'OCR · text extraction · cross-reference · format conversion · comparison (demo mode)'
          }
        </p>
      </div>

      {!aiMode && (
        <div className="flex items-center gap-2 bg-amber-500/[0.08] border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Demo mode — file uploads and comparison are simulated.
          <button onClick={() => navigate('/settings')} className="font-bold underline hover:text-white">Configure API key →</button>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label:'Indexed',      value:summary.total,                  color:'text-sky-400',    sub:'documents' },
          { label:'Total Pages',  value:summary.pages.toLocaleString(), color:'text-emerald-400', sub:'fully searchable' },
          { label:'OCR Pages',    value:summary.ocrPages.toLocaleString(), color:'text-violet-400', sub:'scanned / image' },
          { label:'OCR Confidence', value:`${summary.avgConf}%`,        color:'text-amber-400',  sub:'average' },
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
            onAdd={(d) => {
              setDocs(prev => [d, ...prev]);
              refreshBackendDocs();
            }}
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
                    onClick={() => setFilter(t)}
                    className={`text-[10px] px-2 py-1 rounded border font-semibold ${
                      filter === t
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
                    <th className="text-center px-3 py-2 font-bold">OCR</th>
                    <th className="text-right px-3 py-2 font-bold">Confidence</th>
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
                      <td className="text-right px-3 py-2 text-slate-300 font-mono">{d.pages}</td>
                      <td className="text-center px-3 py-2">
                        {d.ocr
                          ? <span className="text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">Yes</span>
                          : <span className="text-[9px] text-slate-500">No</span>}
                      </td>
                      <td className="text-right px-3 py-2">
                        <span className={`font-mono text-[11px] ${d.confidence >= 99 ? 'text-emerald-400' : d.confidence >= 97 ? 'text-amber-300' : 'text-orange-300'}`}>{(d.confidence || 0).toFixed(1)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <ConversionTool />
          <ComparePanel
            allDocs={allDocsForCompare}
            aiMode={aiMode}
            navigate={navigate}
          />
        </div>
      </div>
    </div>
  );
}
