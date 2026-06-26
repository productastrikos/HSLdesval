import React, { useState, useRef } from 'react';
import { Page, Card, RunButton, ErrorNote, DocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { docworkerEdit, downloadWord, downloadPdf, logInteraction } from '../services/featureApi';

const PRESETS = [
  'Rewrite this document in clear, formal shipyard technical-specification language.',
  'Summarise this document into a one-page executive brief with key points and risks.',
  'Restructure this document with numbered clauses and a table of contents.',
  'Convert the requirements in this document into a checklist.',
  'Translate the key technical content into plain English for a non-specialist reviewer.',
];

export default function DocumentWorker() {
  const [source, setSource]   = useState(null);     // selected doc {name,text}
  const [file, setFile]       = useState(null);     // uploaded File
  const [instruction, setInstruction] = useState(PRESETS[0]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const [dlBusy, setDlBusy]   = useState(false);
  const fileRef = useRef(null);

  const onUpload = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) { setFile(f); setSource(null); setResult(null); setError(null); }
  };

  const run = async () => {
    if (!file && !source?.text) { setError('Select or upload a document to work on.'); return; }
    if (!instruction.trim()) { setError('Describe the change you want.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = file
        ? await docworkerEdit({ file, instruction })
        : await docworkerEdit({ text: source.text, name: source.name, instruction });
      setResult(res);
      logInteraction({ module: 'Document Worker', prompt: instruction, subject: file?.name || source?.name || '', response: res.content || '' }).catch(() => {});
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const docName = file?.name || source?.name || 'document';

  const onWord = async () => {
    setDlBusy(true);
    try { await downloadWord({ title: `${docName.replace(/\.[^.]+$/, '')} (revised)`, text: result.content, filename: `${docName.replace(/\.[^.]+$/, '')}_revised` }); }
    catch (e) { setError(e.message); }
    setDlBusy(false);
  };
  const onPdf = async () => {
    setDlBusy(true);
    try { await downloadPdf({ title: `${docName.replace(/\.[^.]+$/, '')} (revised)`, text: result.content, filename: `${docName.replace(/\.[^.]+$/, '')}_revised` }); }
    catch (e) { setError(e.message); }
    setDlBusy(false);
  };
  const onTxt = () => {
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${docName.replace(/\.[^.]+$/, '')}_revised.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      title="Intelligent Document Worker"
      subtitle="Upload or select a document and instruct the assistant to change it — rewrite, restructure, summarise, reformat, translate or convert to a checklist — then download the edited document as Word, PDF or text."
    >
      <Card title="1 · Document & Instructions" desc="Choose a document, then describe the changes to make.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <DocSource label="Document" value={source} onChange={(v) => { setSource(v); setFile(null); setResult(null); }} />
            <div>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.gif,.dwg,.dxf" className="hidden" onChange={onUpload} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                {file ? file.name : 'Or upload a document to edit'}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Field label="Instruction (what to change)" value={instruction} onChange={setInstruction} textarea rows={4}
              placeholder="e.g. Rewrite as a formal SOTR with numbered clauses…" />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => setInstruction(p)}
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold border bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700">{p.split(' ').slice(0, 3).join(' ')}…</button>
              ))}
            </div>
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Working on the document…">Apply Changes</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading and revising the document…</div>}
      </Card>

      {result && (
        <Card title="2 · Revised Document" right={
          <div className="flex items-center gap-2">
            <button onClick={onWord} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold hover:bg-sky-500/25 disabled:opacity-40">
              {dlBusy ? <Spinner /> : null} Download Word
            </button>
            <button onClick={onPdf} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold hover:bg-red-500/25 disabled:opacity-40">
              {dlBusy ? <Spinner /> : null} Download PDF
            </button>
            <button onClick={onTxt} className="px-3 py-1.5 rounded-lg bg-slate-700/40 text-slate-300 border border-slate-600 text-[11px] font-semibold hover:bg-slate-700/70">Download TXT</button>
          </div>
        }>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-slate-950/40 border border-app-border p-4 text-[12px] text-slate-200 whitespace-pre-wrap leading-relaxed">
            {result.content}
          </div>
          <FeedbackBar module="docworker" subject={docName} />
        </Card>
      )}

      <ModuleChat
        module="docworker"
        title="Ask about this document"
        docText={source?.text}
        docName={source?.name}
        placeholder="e.g. What sections does this document contain?"
      />
    </Page>
  );
}
