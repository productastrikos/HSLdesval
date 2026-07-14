import React, { useState, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, EditableColumns, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { docworkerExtract, docworkerEdit, extractText, downloadWord, downloadPdf, logInteraction } from '../services/featureApi';
import { convertFile, convertBatch } from '../services/aiService';

const CONVERT_FORMATS = [
  { id: 'XLSX', label: 'Excel (.xlsx)' },
  { id: 'CSV',  label: 'CSV (.csv)' },
  { id: 'ODS',  label: 'OpenDocument Sheet (.ods)' },
  { id: 'TXT',  label: 'Text (.txt)' },
  { id: 'DOCX', label: 'Word (.doc)' },
  { id: 'ODT',  label: 'OpenDocument Text (.odt)' },
];

const PRESETS = {
  'Ship Specifications': {
    prompt: 'Extract the ship / vessel specifications (principal particulars, capacities, ratings) from this document.',
    columns: ['Parameter', 'Value', 'Unit', 'Page Number', 'Reference'],
  },
  'Equipment Schedule': {
    prompt: 'Extract every equipment / system item with its maker and rating.',
    columns: ['Equipment Name', 'OEM / Maker', 'Capacity / Rating', 'Quantity', 'Page Number', 'Reference'],
  },
  'Requirements List': {
    prompt: 'Extract every distinct technical requirement stated in this document.',
    columns: ['Clause Ref', 'Requirement', 'Page Number', 'Category'],
  },
  'Custom': { prompt: '', columns: [] },
};

const EDIT_PRESETS = [
  'Rewrite this document in clear, formal shipyard technical-specification language.',
  'Summarise this document into a one-page executive brief with key points and risks.',
  'Restructure this document with numbered clauses and a table of contents.',
  'Convert the requirements in this document into a checklist.',
  'Translate the key technical content into plain English for a non-specialist reviewer.',
];

const ACCEPT = '.pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.gif,.dwg,.dxf';

export default function Converter() {
  const [mode, setMode] = useState('extract');   // 'extract' | 'edit'

  // Shared sources: documents selected from the store + files uploaded here.
  const [docs, setDocs]       = useState([]);     // from MultiDocSource
  const [uploads, setUploads] = useState([]);     // [{name,text}] from file upload
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Extract mode
  const [preset, setPreset]   = useState('Ship Specifications');
  const [prompt, setPrompt]   = useState(PRESETS['Ship Specifications'].prompt);
  const [columns, setColumns] = useState(PRESETS['Ship Specifications'].columns);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);

  // Edit mode
  const [instruction, setInstruction] = useState(EDIT_PRESETS[0]);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr]   = useState(null);
  const [edited, setEdited]     = useState(null);
  const [dlBusy, setDlBusy]     = useState(false);

  // Convert-format mode (operates on the raw file bytes, not extracted text)
  const [cvFiles,  setCvFiles]  = useState([]);       // File[]
  const [cvFormat, setCvFormat] = useState('XLSX');
  const [cvBusy,   setCvBusy]   = useState(false);
  const [cvErr,    setCvErr]    = useState(null);
  const [cvMsg,    setCvMsg]    = useState(null);
  const cvFileRef = useRef(null);

  const sources = [...docs.map(d => ({ name: d.name, text: d.text })), ...uploads];

  const applyPreset = (p) => {
    setPreset(p);
    setPrompt(PRESETS[p].prompt);
    setColumns(PRESETS[p].columns);
  };

  const onUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true); setError(null);
    try {
      for (const f of files) {
        const r = await extractText(f);
        setUploads(u => [...u, { name: r.name, text: r.text }]);
      }
    } catch (err) { setError(err.message); }
    setUploading(false);
  };

  // ── Extract ────────────────────────────────────────────────────────────────
  const runExtract = async () => {
    if (!sources.length) { setError('Select or upload at least one document first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const body = sources.length > 1
        ? { sources, prompt, columns }
        : { text: sources[0].text, name: sources[0].name, prompt, columns };
      const res = await docworkerExtract(body);
      setResult(res);
      logInteraction({ module: 'Document Converter', prompt, subject: sources.map(s => s.name).join(', '),
        response: `Extracted ${res.rows?.length || 0} rows into columns: ${(res.columns || columns).join(' | ')}.` }).catch(() => {});
      if (!res.rows?.length) setError('No rows were extracted. Refine the prompt or the columns.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // ── Rewrite / Summarize ──────────────────────────────────────────────────────
  const runEdit = async () => {
    if (!sources.length) { setEditErr('Select or upload a document to work on.'); return; }
    if (!instruction.trim()) { setEditErr('Describe the change you want.'); return; }
    setEditBusy(true); setEditErr(null); setEdited(null);
    try {
      const src = sources[0];   // rewrite operates on a single document
      const res = await docworkerEdit({ text: src.text, name: src.name, instruction });
      setEdited(res);
      logInteraction({ module: 'Document Converter', prompt: instruction, subject: src.name, response: res.content || '' }).catch(() => {});
    } catch (e) { setEditErr(e.message); }
    setEditBusy(false);
  };

  const editName = (sources[0]?.name || 'document').replace(/\.[^.]+$/, '');
  const downloadEdit = async (fmt) => {
    if (!edited?.content) return;
    if (fmt === 'txt') {
      const blob = new Blob([edited.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${editName}_revised.txt`; a.click(); URL.revokeObjectURL(url);
      return;
    }
    setDlBusy(true);
    try {
      const payload = { title: `${editName} (revised)`, text: edited.content, filename: `${editName}_revised` };
      if (fmt === 'pdf') await downloadPdf(payload); else await downloadWord(payload);
    } catch (e) { setEditErr(e.message); }
    setDlBusy(false);
  };

  // ── Convert file format (single or batch → ZIP) ──────────────────────────────
  const onPickConvert = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) { setCvFiles(prev => [...prev, ...files]); setCvMsg(null); setCvErr(null); }
  };
  const runConvert = async () => {
    if (!cvFiles.length) { setCvErr('Add at least one file to convert.'); return; }
    setCvBusy(true); setCvErr(null); setCvMsg(null);
    try {
      if (cvFiles.length === 1) {
        await convertFile(cvFiles[0], cvFormat);
        setCvMsg(`Converted “${cvFiles[0].name}” to ${cvFormat}. Your download has started.`);
      } else {
        const r = await convertBatch(cvFiles, cvFormat);
        setCvMsg(`Converted ${r.converted ?? cvFiles.length} file(s) to ${cvFormat} — a ZIP has been downloaded${r.failed ? ` · ${r.failed} file(s) could not be read (see _errors.txt)` : ''}.`);
      }
      logInteraction({ module: 'Document Converter', prompt: `Convert ${cvFiles.length} file(s) → ${cvFormat}`,
        subject: cvFiles.map(f => f.name).join(', '), response: `Format conversion to ${cvFormat}.` }).catch(() => {});
    } catch (e) { setCvErr(e.message); }
    setCvBusy(false);
  };

  const TABS = [
    { id: 'extract', label: 'Extract to table', desc: 'Prompt → custom columns → table' },
    { id: 'edit',    label: 'Rewrite / Summarize', desc: 'Reformat, summarise, translate' },
    { id: 'convert', label: 'Convert file format', desc: 'PDF/DOCX/image → Excel/Word/Text · batch → ZIP' },
  ];

  return (
    <Page
      title="Intelligent Document Converter"
      subtitle="Select or upload one or many documents, then either extract structured data into your own columns (consolidating across documents) or rewrite/summarise/translate a document. Fully prompt-driven — export to Excel, Word or PDF."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TABS.map(t => {
          const active = mode === t.id;
          return (
            <button key={t.id} onClick={() => setMode(t.id)}
              className={`text-left rounded-xl border px-4 py-3 transition-colors ${active ? 'bg-gradient-to-r from-sky-500/15 to-indigo-500/15 border-sky-500/40' : 'bg-app-panel border-app-border hover:border-slate-600'}`}>
              <div className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-300'}`}>{t.label}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{t.desc}</div>
            </button>
          );
        })}
      </div>

      {mode !== 'convert' && (
      <Card title="1 · Documents" desc="Select uploaded documents (Select-all supported) and/or upload files here. Extraction consolidates across all selected documents.">
        <MultiDocSource label="Source documents" values={docs} onChange={(v) => { setDocs(v); setResult(null); setEdited(null); }} />
        <div>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors disabled:opacity-40">
            {uploading ? <Spinner /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>}
            {uploading ? 'Reading…' : 'Or upload file(s) for this conversion'}
          </button>
        </div>
        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {uploads.map((u, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                {u.name}
                <button onClick={() => setUploads(us => us.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300">×</button>
              </span>
            ))}
          </div>
        )}
      </Card>
      )}

      {mode === 'extract' && (
        <>
          <Card title="2 · Extraction Request" desc="Choose a preset or write a custom prompt, and edit the output columns before extracting.">
            <div>
              <label className="text-[11px] font-semibold text-slate-300">Preset</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {Object.keys(PRESETS).map(p => (
                  <button key={p} onClick={() => applyPreset(p)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${preset === p ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}>{p}</button>
                ))}
              </div>
            </div>
            <Field label="Prompt (what to extract)" value={prompt} onChange={setPrompt} textarea rows={3}
              placeholder="e.g. Extract the principal particulars and capacities…" />
            <EditableColumns columns={columns} onChange={setColumns}
              label="Output columns (edit before extracting — leave empty to let the AI choose)" />
            <RunButton onClick={runExtract} busy={busy} busyLabel="Extracting…">Extract to Table</RunButton>
            <ErrorNote>{error}</ErrorNote>
          </Card>

          {result && (
            <Card title="3 · Extracted Data" desc="Edit cells if needed, copy for Excel, or download. Verify against the source before issue.">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                <StatTile label="Rows" value={result.rowCount} tone="emerald" />
                <StatTile label="Columns" value={result.columns?.length || 0} tone="sky" />
                <StatTile label="Sources" value={sources.length} tone="violet" />
              </div>
              <ResultTable
                columns={result.columns}
                rows={result.rows}
                editable
                onRowsChange={(rows) => setResult(r => ({ ...r, rows, rowCount: rows.length }))}
                title={preset === 'Custom' ? 'Extracted data' : preset}
                sheetName={(preset === 'Custom' ? 'Extract' : preset).slice(0, 28)}
                downloadName={`${(result.name || 'document').replace(/[^a-z0-9]+/gi, '_')}_${preset.replace(/[^a-z0-9]+/gi, '_')}`}
              />
              <FeedbackBar module="converter" subject={result.name} />
            </Card>
          )}
        </>
      )}

      {mode === 'edit' && (
        <>
          <Card title="2 · Rewrite / Summarize" desc="Operates on the first selected/uploaded document. Describe the change to make.">
            <Field label="Instruction (what to change)" value={instruction} onChange={setInstruction} textarea rows={4}
              placeholder="e.g. Rewrite as a formal SOTR with numbered clauses…" />
            <div className="flex flex-wrap gap-1.5">
              {EDIT_PRESETS.map((p, i) => (
                <button key={i} onClick={() => setInstruction(p)}
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold border bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700">{p.split(' ').slice(0, 3).join(' ')}…</button>
              ))}
            </div>
            <RunButton onClick={runEdit} busy={editBusy} busyLabel="Working on the document…">Apply Changes</RunButton>
            <ErrorNote>{editErr}</ErrorNote>
          </Card>

          {edited && (
            <Card title="3 · Revised Document" right={
              <div className="flex items-center gap-2">
                <button onClick={() => downloadEdit('word')} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold hover:bg-sky-500/25 disabled:opacity-40">{dlBusy ? <Spinner /> : null} Word</button>
                <button onClick={() => downloadEdit('pdf')} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold hover:bg-red-500/25 disabled:opacity-40">{dlBusy ? <Spinner /> : null} PDF</button>
                <button onClick={() => downloadEdit('txt')} className="px-3 py-1.5 rounded-lg bg-slate-700/40 text-slate-300 border border-slate-600 text-[11px] font-semibold hover:bg-slate-700/70">TXT</button>
              </div>
            }>
              <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-slate-950/40 border border-app-border p-4 text-[12px] text-slate-200 whitespace-pre-wrap leading-relaxed">
                {edited.content}
              </div>
              <FeedbackBar module="converter" subject={edited.name} />
            </Card>
          )}
        </>
      )}

      {mode === 'convert' && (
        <Card title="Convert file format" desc="Convert one or many files (PDF, DOCX, scanned images, CSV, CAD) into a target format. One file downloads directly; multiple files download together as a ZIP. Scanned/graphical PDFs are read with OCR before conversion.">
          <div>
            <input ref={cvFileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onPickConvert} />
            <button onClick={() => cvFileRef.current?.click()} disabled={cvBusy}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors disabled:opacity-40">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              Add file(s) to convert
            </button>
          </div>

          {cvFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cvFiles.map((f, i) => (
                <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                  {f.name} <span className="text-slate-500">· {(f.size / 1024 / 1024).toFixed(1)}MB</span>
                  <button onClick={() => setCvFiles(fs => fs.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300">×</button>
                </span>
              ))}
              <button onClick={() => setCvFiles([])} className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-red-300">Clear all</button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">Convert to</label>
              <select value={cvFormat} onChange={e => setCvFormat(e.target.value)}
                className="text-[12px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200">
                {CONVERT_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <RunButton onClick={runConvert} busy={cvBusy} busyLabel={cvFiles.length > 1 ? 'Converting batch…' : 'Converting…'}>
              {cvFiles.length > 1 ? `Convert ${cvFiles.length} files → ZIP` : 'Convert & Download'}
            </RunButton>
          </div>

          {['XLSX', 'CSV', 'ODS'].includes(cvFormat) && (
            <p className="text-[10px] text-slate-500">Structured formats (Excel / CSV / ODS) organise each document into the matching official register (equipment / inspection-remarks) — one row per item. Text formats (TXT / Word / ODT) keep the full document content.</p>
          )}
          <ErrorNote>{cvErr}</ErrorNote>
          {cvMsg && (
            <div className="flex items-start gap-2 bg-emerald-500/[0.08] border border-emerald-500/30 rounded-lg px-3 py-2 text-[11px] text-emerald-300">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              {cvMsg}
            </div>
          )}
        </Card>
      )}

      <ModuleChat
        module="converter"
        title="Ask about these documents"
        docText={sources[0]?.text}
        docName={sources[0]?.name}
        placeholder="e.g. Which fields can I extract from this document?"
        suggestions={sources.length ? [
          `What information can be extracted from ${sources[0].name}?`,
          `Suggest useful table columns for ${sources[0].name}.`,
          `Summarise the key data points in this document.`,
        ] : []}
      />
    </Page>
  );
}
