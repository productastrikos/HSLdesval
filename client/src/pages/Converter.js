import React, { useState, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { docworkerExtract, extractText } from '../services/featureApi';

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

export default function Converter() {
  const [preset, setPreset]   = useState('Ship Specifications');
  const [source, setSource]   = useState(null);
  const [prompt, setPrompt]   = useState(PRESETS['Ship Specifications'].prompt);
  const [colText, setColText] = useState(PRESETS['Ship Specifications'].columns.join(', '));
  const [busy, setBusy]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const fileRef = useRef(null);

  const applyPreset = (p) => {
    setPreset(p);
    setPrompt(PRESETS[p].prompt);
    setColText(PRESETS[p].columns.join(', '));
  };

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true); setError(null);
    try {
      const r = await extractText(f);
      setSource({ name: r.name, text: r.text });
    } catch (err) { setError(err.message); }
    setUploading(false);
  };

  const run = async () => {
    if (!source?.text) { setError('Select or upload a document first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const columns = colText.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
      const res = await docworkerExtract({ text: source.text, name: source.name, prompt, columns });
      setResult(res);
      if (!res.rows?.length) setError('No rows were extracted. Refine the prompt or the columns.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <Page
      title="Intelligent Document Converter"
      subtitle="Select or upload any document, tell the assistant what to extract, and define your own columns — then download the result as Excel or Word. Fully prompt-driven: ask for different fields, formats and table columns on demand."
    >
      <Card title="1 · Source & Extraction Request" desc="Pick a pre-loaded / uploaded document, or upload one here. Choose a preset or write a custom prompt + columns.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <DocSource label="Document" value={source} onChange={(v) => { setSource(v); setResult(null); }} />
            <div>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg" className="hidden" onChange={onUpload} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors disabled:opacity-40">
                {uploading ? <Spinner /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>}
                {uploading ? 'Reading…' : 'Or upload a file for this conversion'}
              </button>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-300">Preset</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {Object.keys(PRESETS).map(p => (
                  <button key={p} onClick={() => applyPreset(p)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${preset === p ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}>{p}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <Field label="Prompt (what to extract)" value={prompt} onChange={setPrompt} textarea rows={3}
              placeholder="e.g. Extract the principal particulars and capacities…" />
            <Field label="Target columns (comma-separated — leave blank to let the AI choose)" value={colText} onChange={setColText} textarea rows={2}
              placeholder="Parameter, Value, Unit, Page Number, Reference" />
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Extracting…">Extract to Table</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {result && (
        <Card title="2 · Extracted Data" desc="Download as Excel or Word. Verify against the source before issue.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <StatTile label="Rows" value={result.rowCount} tone="emerald" />
            <StatTile label="Columns" value={result.columns?.length || 0} tone="sky" />
            <StatTile label="Source" value={(result.name || '').slice(0, 14) || '—'} tone="violet" />
          </div>
          <ResultTable
            columns={result.columns}
            rows={result.rows}
            title={`${preset === 'Custom' ? 'Extracted data' : preset}`}
            sheetName={(preset === 'Custom' ? 'Extract' : preset).slice(0, 28)}
            downloadName={`${(result.name || 'document').replace(/\.[^.]+$/, '')}_${preset.replace(/[^a-z0-9]+/gi, '_')}`}
          />
          <FeedbackBar module="converter" subject={result.name} />
        </Card>
      )}

      <ModuleChat
        module="converter"
        title="Ask about this document"
        docText={source?.text}
        docName={source?.name}
        placeholder="e.g. Which fields can I extract from this document?"
        suggestions={source ? [
          `What information can be extracted from ${source.name}?`,
          `Suggest useful table columns for ${source.name}.`,
          `Summarise the key data points in this document.`,
        ] : []}
      />
    </Page>
  );
}
