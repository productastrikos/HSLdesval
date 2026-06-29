import React, { useState, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { compareMulti } from '../services/aiService';
import { getSelectableDoc } from '../services/docStore';
import { logInteraction } from '../services/featureApi';

const ACCEPT = '.pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.gif,.dwg,.dxf';

export default function DocumentCompare() {
  const [docs, setDocs]       = useState([]);     // selected from store (MultiDocSource)
  const [uploads, setUploads] = useState([]);     // [{ file }]
  const [prompt, setPrompt]   = useState('Compare these documents and list every significant difference and commonality in requirements, technical particulars, values and scope.');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const fileRef = useRef(null);

  const onUpload = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) setUploads(u => [...u, ...files.map(file => ({ file }))]);
    setResult(null);
  };

  const total = docs.length + uploads.length;

  const run = async () => {
    if (total < 2) { setError('Select or upload at least two documents to compare.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      // Selected docs: send their original file blob when available (so drawings /
      // .dwg / scanned PDFs are read server-side), else send the extracted text.
      const files = uploads.map(u => u.file);
      const docTexts = [];
      for (const d of docs) {
        const full = await getSelectableDoc(d.id);
        if (full?.file) files.push(new File([full.file], full.name || d.name || 'document', { type: full.mime || '' }));
        else docTexts.push({ name: d.name, text: full?.text || d.text || '' });
      }
      const res = await compareMulti({ files, docs: docTexts, prompt });
      setResult(res);
      logInteraction({ module: 'Document Comparison', prompt, subject: (res.documents || []).join(' vs '),
        response: `Compared ${res.documents?.length || total} documents — ${res.rowCount || 0} aspects.` }).catch(() => {});
      if (!res.rows?.length) setError('No structured comparison could be produced from these documents.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <Page
      title="Document Comparison"
      subtitle="Compare two or more documents of any type — regular documents, ship designs, drawings and AutoCAD .dwg/.dxf files — using a prompt. The assistant produces a structured matrix (one column per document) you can export to Excel, Word or PDF."
    >
      <Card title="1 · Documents & Comparison Request" desc="Select documents from your workspace and/or upload files (any type). At least two are required.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Select documents to compare" values={docs} onChange={(v) => { setDocs(v); setResult(null); }} />
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-300">Or upload files (PDF · DOCX · image · .dwg / .dxf)</label>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onUpload} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              Upload file(s) to compare
            </button>
            {uploads.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {uploads.map((u, i) => (
                  <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                    {u.file.name}
                    <button onClick={() => setUploads(us => us.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <Field label="Comparison prompt" value={prompt} onChange={setPrompt} textarea rows={3}
          placeholder="e.g. Compare the equipment specifications and highlight deviations from the POTS requirements." />
        <RunButton onClick={run} busy={busy} busyLabel="Reading and comparing documents…">{total > 1 ? `Compare ${total} Documents` : 'Compare Documents'}</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading each document (drawings/DWG are decoded too) and building the comparison…</div>}
      </Card>

      {result?.rows?.length > 0 && (
        <Card title="2 · Comparison" desc="One column per document. Copy for Excel or export.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <StatTile label="Documents" value={result.documents?.length || total} tone="violet" />
            <StatTile label="Aspects" value={result.rowCount} tone="amber" />
            <StatTile label="Columns" value={result.columns?.length || 0} tone="sky" />
          </div>
          <ResultTable
            columns={result.columns}
            rows={result.rows}
            title={`Comparison of ${(result.documents || []).length} documents`}
            sheetName="Comparison"
            downloadName={`comparison_${(result.documents || ['docs']).map(n => n.replace(/[^a-z0-9]+/gi, '_').slice(0, 12)).join('_vs_').slice(0, 60)}`}
          />
          {result.documents?.length > 0 && <div className="text-[10px] text-slate-500">Compared: {result.documents.join(' · ')}</div>}
          <FeedbackBar module="compare" subject={(result.documents || []).join(' vs ')} />
        </Card>
      )}

      <ModuleChat
        module="compare"
        title="Ask about document comparison"
        placeholder="e.g. What should I compare between a POTS and a vendor binding-data document?"
        suggestions={[
          'What are the key things to compare between two technical specifications?',
          'How do I compare a vendor offer against the SOTR?',
          'Compare two SLD drawings for differences in equipment and cabling.',
        ]}
      />
    </Page>
  );
}
