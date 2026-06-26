import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { bomGenerate, bomSotr, downloadWord, downloadPdf, logInteraction } from '../services/featureApi';

const DEFAULT_COLS = 'Discipline, System, Equipment Name, OEM, Capacity, Unit, Quantity, Page Number, Reference';

export default function BomGenerator() {
  const [sources, setSources] = useState([]);
  const [prompt, setPrompt]   = useState('Generate a system-wise and discipline-wise Bill of Materials for the vessel in the prescribed HSL format. Group and order rows by Discipline (Electrical, Machinery, Hull, Outfit, Piping, HVAC…) and then by System. Where a quantity is not stated, estimate it by calculation and note the basis in the Reference (e.g. number of PA speakers from a compartment’s area, light fittings from deck area).');
  const [colText, setColText] = useState(DEFAULT_COLS);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [bom, setBom]         = useState(null);

  // SOTR
  const [sotrPrompt, setSotrPrompt] = useState('Generate an SOTR covering every equipment/system in the BOM: scope, technical particulars, applicable class/IRS rules, interfaces, documentation, testing and warranty.');
  const [sotrBusy, setSotrBusy]     = useState(false);
  const [sotr, setSotr]             = useState(null);
  const [sotrErr, setSotrErr]       = useState(null);
  const [dlBusy, setDlBusy]         = useState(false);

  const run = async () => {
    if (!sources.length) { setError('Select at least one source (RFP / Build Specification).'); return; }
    setBusy(true); setError(null); setBom(null); setSotr(null);
    try {
      const columns = colText.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
      const res = await bomGenerate({ sources: sources.map(s => ({ name: s.name, text: s.text })), prompt, columns });
      setBom(res);
      logInteraction({ module: 'BOM Generation', prompt, subject: sources.map(s => s.name).join(', '),
        response: `Generated Bill of Materials — ${res.rowCount || res.rows?.length || 0} items, columns: ${(res.columns || []).join(' | ')}.` }).catch(() => {});
      if (!res.rows?.length) setError('No BOM items were generated. Try different source documents or prompt.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const genSotr = async () => {
    if (!bom?.rows?.length) return;
    setSotrBusy(true); setSotrErr(null); setSotr(null);
    try {
      const s = await bomSotr({ bom: bom.rows, columns: bom.columns, prompt: sotrPrompt, title: 'Statement of Technical Requirements' });
      setSotr(s);
      logInteraction({ module: 'SOTR Generation', prompt: sotrPrompt, subject: 'SOTR from BOM', response: s.content || '' }).catch(() => {});
    } catch (e) { setSotrErr(e.message); }
    setSotrBusy(false);
  };

  const downloadSotr = async (fmt) => {
    if (!sotr?.content) return;
    if (fmt === 'txt') {
      const blob = new Blob([sotr.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'SOTR.txt'; a.click(); URL.revokeObjectURL(url);
      return;
    }
    setDlBusy(true);
    try {
      const payload = { title: sotr.title || 'SOTR', text: sotr.content, filename: 'SOTR' };
      if (fmt === 'pdf') await downloadPdf(payload); else await downloadWord(payload);
    }
    catch (e) { setSotrErr(e.message); }
    setDlBusy(false);
  };

  return (
    <Page
      title="BOM & SOTR Generator"
      subtitle="Generate a Bill of Materials from the RFP and Build Specification — with Equipment Name, OEM, Capacity, Page Number and Reference, plus AI estimation/calculation — then derive a Statement of Technical Requirements (SOTR) from the BOM, guided by your prompt."
    >
      <Card title="1 · Sources & BOM Request" desc="Select the RFP, Build Specification and any GA/spec documents to build the BOM from.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Source documents (RFP / Build Spec / GA / specs)" values={sources} onChange={(v) => { setSources(v); setBom(null); }} />
          <div className="space-y-3">
            <Field label="Prompt (customizable — include any estimation request)" value={prompt} onChange={setPrompt} textarea rows={4} />
            <Field label="BOM columns" value={colText} onChange={setColText} textarea rows={2} placeholder={DEFAULT_COLS} />
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Generating BOM…">Generate BOM</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading the sources section-by-section and compiling the BOM…</div>}
      </Card>

      {bom && (
        <>
          <Card title="2 · Bill of Materials" desc="Download as Excel, Word or PDF.">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              <StatTile label="BOM Items" value={bom.rowCount} tone="emerald" />
              <StatTile label="Columns" value={bom.columns?.length || 0} tone="sky" />
              <StatTile label="Sources" value={bom.sources?.length || 0} tone="violet" />
            </div>
            <ResultTable columns={bom.columns} rows={bom.rows} title="Bill of Materials" sheetName="BOM"
              downloadName="BOM" />
            <FeedbackBar module="bom" subject={`BOM (${bom.sources?.join(', ')})`} />
          </Card>

          <Card title="3 · Generate SOTR from BOM" desc="Derive a Statement of Technical Requirements from the BOM above, guided by your prompt.">
            <Field label="SOTR prompt" value={sotrPrompt} onChange={setSotrPrompt} textarea rows={3} />
            <RunButton onClick={genSotr} busy={sotrBusy} busyLabel="Drafting SOTR…">Generate SOTR</RunButton>
            <ErrorNote>{sotrErr}</ErrorNote>
            {sotr && (
              <div className="space-y-2">
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => downloadSotr('word')} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold hover:bg-sky-500/25 disabled:opacity-40">
                    {dlBusy ? <Spinner /> : null} Download Word
                  </button>
                  <button onClick={() => downloadSotr('pdf')} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold hover:bg-red-500/25 disabled:opacity-40">
                    {dlBusy ? <Spinner /> : null} Download PDF
                  </button>
                  <button onClick={() => downloadSotr('txt')} className="px-3 py-1.5 rounded-lg bg-slate-700/40 text-slate-300 border border-slate-600 text-[11px] font-semibold hover:bg-slate-700/70">Download TXT</button>
                </div>
                <div className="max-h-[55vh] overflow-y-auto rounded-lg bg-slate-950/40 border border-app-border p-4 text-[12px] text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {sotr.content}
                </div>
                {sotr.citations?.length > 0 && <div className="text-[10px] text-slate-500">Grounded in: {sotr.citations.join(' · ')}</div>}
                <FeedbackBar module="sotr" subject="SOTR" />
              </div>
            )}
          </Card>
        </>
      )}

      <ModuleChat
        module="bom"
        title="Ask about BOM / SOTR generation"
        placeholder="e.g. How would you estimate the number of speakers for a 200 m² compartment?"
        suggestions={[
          'What columns should a good shipbuilding BOM include?',
          'How do you estimate equipment quantities from a GA plan?',
          'What goes into an SOTR clause for a navigation system?',
        ]}
      />
    </Page>
  );
}
