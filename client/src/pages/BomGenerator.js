import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, EditableColumns, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { bomGenerate, bomSotr, downloadWord, downloadPdf, logInteraction } from '../services/featureApi';
import { saveArtifact } from '../services/docStore';

function SaveButton({ onClick, saved }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold hover:bg-emerald-500/25">
      {saved ? '✓ Saved' : 'Save'}
    </button>
  );
}

const DEFAULT_COLS = ['Discipline', 'System', 'Equipment Name', 'OEM', 'Capacity', 'Unit', 'Quantity', 'Page Number', 'Reference'];

// ── Module switcher ──────────────────────────────────────────────────────────
function ModeToggle({ mode, setMode }) {
  const tabs = [
    { id: 'bom',  label: 'Bill of Materials',  desc: 'List every equipment / material item' },
    { id: 'sotr', label: 'Statement of Technical Requirements', desc: 'Draft formal technical requirements' },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {tabs.map(t => {
        const active = mode === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            className={`text-left rounded-xl border px-4 py-3 transition-colors ${
              active
                ? 'bg-gradient-to-r from-sky-500/15 to-indigo-500/15 border-sky-500/40'
                : 'bg-app-panel border-app-border hover:border-slate-600'
            }`}
          >
            <div className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-300'}`}>{t.label}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{t.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

// ── BOM module ───────────────────────────────────────────────────────────────
function BomModule() {
  const [sources, setSources] = useState([]);
  const [prompt, setPrompt]   = useState('Generate a system-wise and discipline-wise Bill of Materials for the vessel in the prescribed HSL format. Group and order rows by Discipline (Electrical, Machinery, Hull, Outfit, Piping, HVAC…) and then by System. Where a quantity is not stated, estimate it by calculation and note the basis in the Reference (e.g. number of PA speakers from a compartment’s area, light fittings from deck area).');
  const [columns, setColumns] = useState(DEFAULT_COLS);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [bom, setBom]         = useState(null);
  const [saved, setSaved]     = useState(false);

  const saveBom = () => {
    if (!bom?.rows?.length) return;
    saveArtifact('bom', { columns: bom.columns, rows: bom.rows }, { sources: bom.sources || [] });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  const run = async () => {
    if (!sources.length) { setError('Select at least one source (RFP / Build Specification).'); return; }
    setBusy(true); setError(null); setBom(null); setSaved(false);
    try {
      const cols = columns.map(s => s.trim()).filter(Boolean);
      const res = await bomGenerate({ sources: sources.map(s => ({ name: s.name, text: s.text })), prompt, columns: cols });
      setBom(res);
      logInteraction({ module: 'BOM Generation', prompt, subject: sources.map(s => s.name).join(', '),
        response: `Generated Bill of Materials — ${res.rowCount || res.rows?.length || 0} items, columns: ${(res.columns || []).join(' | ')}.` }).catch(() => {});
      if (!res.rows?.length) setError('No BOM items were generated. Try different source documents or prompt.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <>
      <Card title="Sources & BOM Request" desc="Select the RFP, Build Specification and any GA/spec documents to build the BOM from.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Source documents (RFP / Build Spec / GA / specs)" values={sources} onChange={(v) => { setSources(v); setBom(null); }} />
          <div className="space-y-3">
            <Field label="Prompt (customizable — include any estimation request)" value={prompt} onChange={setPrompt} textarea rows={4} />
            <EditableColumns columns={columns} onChange={setColumns} label="BOM columns (edit before generating)" />
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Generating BOM…">Generate BOM</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading the sources section-by-section and compiling the BOM…</div>}
      </Card>

      {bom && (
        <Card title="Bill of Materials" desc="Review and edit rows inline, then Save (the saved BOM is used by Ship Cost Estimation) or export." right={<SaveButton onClick={saveBom} saved={saved} />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <StatTile label="BOM Items" value={bom.rowCount} tone="emerald" />
            <StatTile label="Columns" value={bom.columns?.length || 0} tone="sky" />
            <StatTile label="Sources" value={bom.sources?.length || 0} tone="violet" />
          </div>
          <ResultTable columns={bom.columns} rows={bom.rows} editable
            onRowsChange={(rows) => setBom(b => ({ ...b, rows, rowCount: rows.length }))}
            title="Bill of Materials" sheetName="BOM" downloadName="BOM" />
          <FeedbackBar module="bom" subject={`BOM (${bom.sources?.join(', ')})`} />
        </Card>
      )}
    </>
  );
}

// ── SOTR module ──────────────────────────────────────────────────────────────
function SotrModule() {
  const [sources, setSources] = useState([]);
  const [prompt, setPrompt]   = useState('Generate a Statement of Technical Requirements directly from the build specification, covering every equipment/system: scope, technical particulars, applicable class/IRS rules, interfaces, documentation, testing and warranty.');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [sotr, setSotr]       = useState(null);
  const [dlBusy, setDlBusy]   = useState(false);
  const [saved, setSaved]     = useState(false);

  const saveSotr = () => {
    if (!sotr?.content) return;
    saveArtifact('sotr', { title: sotr.title, content: sotr.content });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  const run = async () => {
    if (!sources.length) { setError('Select at least one source (Build Specification / RFP).'); return; }
    setBusy(true); setError(null); setSotr(null);
    try {
      const res = await bomSotr({ sources: sources.map(d => ({ name: d.name, text: d.text })), prompt, title: 'Statement of Technical Requirements' });
      setSotr(res);
      logInteraction({ module: 'SOTR Generation', prompt, subject: sources.map(d => d.name).join(', '),
        response: res.content || '' }).catch(() => {});
      if (!res.content?.trim()) setError('No SOTR could be generated. Try different source documents or prompt.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const download = async (fmt) => {
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
    } catch (e) { setError(e.message); }
    setDlBusy(false);
  };

  return (
    <>
      <Card title="Sources & SOTR Request" desc="Select the Build Specification / RFP to draft the Statement of Technical Requirements directly from.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Source documents (Build Spec / RFP / specs)" values={sources} onChange={(v) => { setSources(v); setSotr(null); }} />
          <div className="space-y-3">
            <Field label="Prompt (customizable)" value={prompt} onChange={setPrompt} textarea rows={5} />
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Drafting SOTR…">Generate SOTR</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Harvesting technical requirements section-by-section and drafting the SOTR…</div>}
      </Card>

      {sotr && (
        <Card title="Statement of Technical Requirements" desc="Edit the document below, Save it, then export. Edits are reflected in the Word/PDF/TXT exports.">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <SaveButton onClick={saveSotr} saved={saved} />
            <button onClick={() => download('word')} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold hover:bg-sky-500/25 disabled:opacity-40">
              {dlBusy ? <Spinner /> : null} Download Word
            </button>
            <button onClick={() => download('pdf')} disabled={dlBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold hover:bg-red-500/25 disabled:opacity-40">
              {dlBusy ? <Spinner /> : null} Download PDF
            </button>
            <button onClick={() => download('txt')} className="px-3 py-1.5 rounded-lg bg-slate-700/40 text-slate-300 border border-slate-600 text-[11px] font-semibold hover:bg-slate-700/70">Download TXT</button>
          </div>
          <textarea
            value={sotr.content}
            onChange={(e) => setSotr(s => ({ ...s, content: e.target.value }))}
            className="w-full max-h-[55vh] min-h-[40vh] overflow-y-auto rounded-lg bg-slate-950/40 border border-app-border p-4 text-[12px] text-slate-200 leading-relaxed resize-y font-mono"
          />
          {sotr.citations?.length > 0 && <div className="text-[10px] text-slate-500">Grounded in: {sotr.citations.join(' · ')}</div>}
          <FeedbackBar module="sotr" subject={`SOTR (${sources.map(s => s.name).join(', ')})`} />
        </Card>
      )}
    </>
  );
}

export default function BomGenerator() {
  const [mode, setMode] = useState('bom');

  return (
    <Page
      title="BOM & SOTR Generator"
      subtitle="Two independent modules built from your build specifications. Generate a Bill of Materials (with Equipment Name, OEM, Capacity, Page Number, Reference and AI estimation), or draft a Statement of Technical Requirements directly from the specs — whichever you need."
    >
      <ModeToggle mode={mode} setMode={setMode} />

      {mode === 'bom' ? <BomModule /> : <SotrModule />}

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
