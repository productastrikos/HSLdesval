import React, { useState, useEffect } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, Field, Spinner } from '../components/feature/FeatureKit';
import { extractDrawing } from '../services/featureApi';
import { listUserDocs, getUserDoc } from '../services/docStore';

const PRESETS = {
  'Cable Schedule': {
    prompt: 'Prepare a cable schedule from this system drawing. Trace every cable run between equipment, using the circled cable-type numbers and the cable legend to fill cable size and type.',
    columns: ['Sl.No', 'Cable Tag', 'From Equipment', 'From Location', 'To Equipment', 'To Location', 'Cable Size', 'Cable Type', 'Remarks'],
  },
  'Equipment / BOM List': {
    prompt: 'Prepare the equipment / bill-of-materials list from this drawing using the equipment legend.',
    columns: ['Sl.No', 'Equipment Tag', 'Description', 'Part Number', 'Quantity', 'Location', 'Remarks'],
  },
  'Equipment Coordinates': {
    prompt: 'Extract the equipment coordinate schedule (ship X/Y/Z) from this drawing.',
    columns: ['Sl.No', 'Name', 'Description', 'Ship X', 'Ship Y', 'Ship Z'],
  },
  'Custom': { prompt: '', columns: [] },
};

export default function DrawingExtract() {
  const [preset, setPreset]   = useState('Cable Schedule');
  const [prompt, setPrompt]   = useState(PRESETS['Cable Schedule'].prompt);
  const [colText, setColText] = useState(PRESETS['Cable Schedule'].columns.join(', '));
  const [docs, setDocs]       = useState([]);
  const [docId, setDocId]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);

  useEffect(() => {
    const load = () => listUserDocs().then(setDocs).catch(() => setDocs([]));
    load();
    window.addEventListener('docstore:changed', load);
    return () => window.removeEventListener('docstore:changed', load);
  }, []);

  const applyPreset = (p) => {
    setPreset(p);
    setPrompt(PRESETS[p].prompt);
    setColText(PRESETS[p].columns.join(', '));
  };

  const run = async () => {
    if (!docId) { setError('Select an uploaded drawing first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const doc = await getUserDoc(docId);
      if (!doc?.file) { setError('The selected document has no original file to read.'); setBusy(false); return; }
      const file = new File([doc.file], doc.name || 'drawing', { type: doc.mime || doc.file.type || 'application/pdf' });
      const columns = colText.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
      const res = await extractDrawing(file, prompt, columns.length ? columns : null);
      setResult(res);
      if (!res.rows?.length) setError('No rows were extracted. Try a more specific prompt or check the drawing quality.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const tb = result?.meta?.titleBlock || {};
  const cableLegend = result?.legend?.cableLegend || [];
  const selectedDoc = docs.find(d => d.id === docId);

  return (
    <Page
      title="Drawing Data Extraction"
      subtitle="Intelligently read engineering drawings (PDF / scanned PDF / image) — cable tags, equipment tags, legends and symbols — and extract the data you ask for into Excel. Multi-page drawings are read sheet-by-sheet with the legend resolved as context."
    >
      <Card title="1 · Drawing & Extraction Request" desc="Pick a drawing you uploaded on the Documents page, choose what to extract, and refine the target columns.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <label className="text-[11px] font-semibold text-slate-300">Drawing</label>
            {docs.length === 0 ? (
              <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700">
                No documents yet — upload a drawing on the <span className="text-sky-400">Documents</span> page.
              </div>
            ) : (
              <select
                value={docId}
                onChange={(e) => { setDocId(e.target.value); setResult(null); setError(null); }}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200"
              >
                <option value="">Select an uploaded drawing…</option>
                {docs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.type}</option>)}
              </select>
            )}
            {selectedDoc && <div className="text-[10px] text-emerald-400">✓ {selectedDoc.name}</div>}
            <div>
              <label className="text-[11px] font-semibold text-slate-300">Extraction preset</label>
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
              placeholder="e.g. Prepare a cable schedule from the MBSRE system drawing…" />
            <Field label="Target columns (comma-separated)" value={colText} onChange={setColText} textarea rows={2}
              placeholder="Sl.No, Cable Tag, From Equipment, …" />
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Reading drawing sheet-by-sheet…">Extract to Table</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Large multi-page drawings can take 30–90s as each sheet is interpreted.</div>}
      </Card>

      {result && (
        <>
          <Card title="2 · Drawing Recognised">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatTile label="Rows" value={result.rowCount} tone="emerald" />
              <StatTile label="Sheets Read" value={result.meta?.pagesProcessed ?? '—'} tone="sky" />
              <StatTile label="Drawing No" value={tb.drawingNo || '—'} tone="violet" />
              <StatTile label="Ship No" value={tb.shipNo || '—'} tone="slate" />
              <StatTile label="Cable Types" value={cableLegend.length || '—'} tone="amber" />
            </div>
            {tb.title && <div className="text-[11px] text-slate-400">Title: <span className="text-slate-200">{tb.title}</span>{tb.system ? ` · System: ${tb.system}` : ''}</div>}
            {cableLegend.length > 0 && (
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-400">Cable legend resolved: </span>
                {cableLegend.map((c, i) => <span key={i} className="mr-2">[{c.ref}] {c.type || c.description}{c.size ? ` (${c.size})` : ''};</span>)}
              </div>
            )}
            {result.meta?.perPage?.some(p => p.error) && (
              <div className="text-[10px] text-amber-400">Some sheets could not be read: {result.meta.perPage.filter(p => p.error).map(p => `sheet ${p.page}`).join(', ')}.</div>
            )}
          </Card>

          <Card title="3 · Extracted Table">
            <ResultTable
              columns={result.columns}
              rows={result.rows}
              title={preset === 'Custom' ? 'Extracted data' : preset}
              sheetName={(preset === 'Custom' ? 'Extract' : preset).slice(0, 28)}
              downloadName={`${(tb.drawingNo || selectedDoc?.name || 'drawing').toString().replace(/\.[^.]+$/, '')}_${preset.replace(/[^a-z0-9]+/gi, '_')}`}
              note="Verify against the source drawing before issue. Empty cells indicate data not legible/!shown on the sheet."
            />
          </Card>
        </>
      )}
    </Page>
  );
}
