import React, { useState, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner, FeedbackBar, ModuleChat, Pill } from '../components/feature/FeatureKit';
import { extractDrawing, validateDrawing } from '../services/featureApi';
import { getUserDoc } from '../services/docStore';

const PRESETS = {
  'Cable Schedule': {
    prompt: 'Prepare a cable schedule from this system drawing. Trace every cable run between equipment, using the circled cable-type numbers and the cable legend to fill cable size and type.',
    columns: ['Sl.No', 'Cable Tag', 'From Equipment', 'From Location', 'To Equipment', 'To Location', 'Cable Size', 'Cable Type', 'Remarks'],
  },
  'Equipment / BOM List': {
    prompt: 'Prepare the equipment / bill-of-materials list from this drawing using the equipment legend. Include maker/part number and quantity where shown.',
    columns: ['Sl.No', 'Equipment Tag', 'Description', 'OEM / Part Number', 'Quantity', 'Location', 'Remarks'],
  },
  'GA Ship Specifications': {
    prompt: 'This is a General Arrangement (GA) plan of a ship. Extract the ship specifications / principal particulars (LOA, LBP, beam, depth, draught, GT, deadweight, speed, complement, tank capacities, decks, etc.) exactly as shown.',
    columns: ['Sl.No', 'Parameter', 'Value', 'Unit', 'Remarks'],
  },
  'Compartment Areas': {
    prompt: 'From this General Arrangement plan, list every compartment / space with its deck/location and area (use any stated area; otherwise note it must be measured).',
    columns: ['Sl.No', 'Compartment', 'Deck / Location', 'Area', 'Remarks'],
  },
  'Equipment Coordinates': {
    prompt: 'Extract the equipment coordinate schedule (ship X/Y/Z) from this drawing.',
    columns: ['Sl.No', 'Name', 'Description', 'Ship X', 'Ship Y', 'Ship Z'],
  },
  'Custom': { prompt: '', columns: [] },
};

const V_COLS = ['slNo', 'area', 'irsReference', 'requirement', 'observation', 'status', 'severity', 'recommendation'];
const V_HEAD = ['Sl.No', 'Area', 'IRS Reference', 'Requirement', 'Observation', 'Status', 'Severity', 'Recommendation'];

export default function DrawingExtract() {
  const [mode, setMode]       = useState('extract');   // extract | validate
  const [preset, setPreset]   = useState('Cable Schedule');
  const [prompt, setPrompt]   = useState(PRESETS['Cable Schedule'].prompt);
  const [colText, setColText] = useState(PRESETS['Cable Schedule'].columns.join(', '));
  const [source, setSource]   = useState(null);        // selected doc {id,name,libraryFile,source}
  const [file, setFile]       = useState(null);        // uploaded File
  const [vFocus, setVFocus]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const [vResult, setVResult] = useState(null);
  const fileRef = useRef(null);

  const applyPreset = (p) => { setPreset(p); setPrompt(PRESETS[p].prompt); setColText(PRESETS[p].columns.join(', ')); };

  const onUpload = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) { setFile(f); setSource(null); setResult(null); setVResult(null); setError(null); }
  };

  // Resolve the drawing source into { file } or { libraryId } for the API.
  const resolveSource = async () => {
    if (file) return { file };
    if (!source) throw new Error('Select or upload a drawing first.');
    if (source.source === 'library') return { libraryId: source.libraryFile || source.id };
    const full = await getUserDoc(source.id);
    if (!full?.file) throw new Error('The selected document has no original file to read. Upload the drawing here instead.');
    return { file: new File([full.file], full.name || 'drawing', { type: full.mime || full.file.type || 'application/pdf' }) };
  };

  const runExtract = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const src = await resolveSource();
      const columns = colText.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
      const res = await extractDrawing({ ...src, prompt, columns: columns.length ? columns : null });
      setResult(res);
      if (!res.rows?.length) setError('No rows were extracted. Try a more specific prompt or check the drawing quality.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const runValidate = async () => {
    setBusy(true); setError(null); setVResult(null);
    try {
      const src = await resolveSource();
      const res = await validateDrawing({ ...src, prompt: vFocus });
      setVResult(res);
      if (!res.findings?.length) setError('No findings were produced. Try a clearer drawing or add a focus area.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const tb = result?.meta?.titleBlock || {};
  const cableLegend = result?.legend?.cableLegend || [];
  const cad = result?.cad;
  const srcName = file?.name || source?.name || 'drawing';
  const vRows = (vResult?.findings || []).map(o => { const r = {}; V_COLS.forEach((k, i) => { r[V_HEAD[i]] = o[k] ?? ''; }); return r; });

  return (
    <Page
      title="Drawing Intelligence"
      subtitle="Read engineering drawings (PDF / scanned PDF / image / AutoCAD .dwg/.dxf) — cable schedules, equipment/BOM lists, GA ship specifications and compartment areas — into Excel/Word, or validate the drawing against IRS class rules. Pre-loaded drawings (e.g. the MB/SRE SLD) are ready to use."
    >
      <Card title="1 · Drawing Source">
        <div className="grid md:grid-cols-2 gap-4">
          <DocSource label="Pre-loaded / uploaded drawing" value={source} onChange={(v) => { setSource(v); setFile(null); setResult(null); setVResult(null); }} />
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-300">Or upload a drawing</label>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.dwg,.dxf" className="hidden" onChange={onUpload} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              {file ? file.name : 'PDF · image · AutoCAD .dwg / .dxf'}
            </button>
            <div className="flex gap-1.5">
              <button onClick={() => setMode('extract')} className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${mode === 'extract' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Extract Data</button>
              <button onClick={() => setMode('validate')} className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${mode === 'validate' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Validate vs IRS</button>
            </div>
          </div>
        </div>
      </Card>

      {mode === 'extract' ? (
        <Card title="2 · Extraction Request" desc="Choose what to extract and refine the target columns.">
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(PRESETS).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${preset === p ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}>{p}</button>
            ))}
          </div>
          <Field label="Prompt (what to extract)" value={prompt} onChange={setPrompt} textarea rows={3} />
          <Field label="Target columns (comma-separated)" value={colText} onChange={setColText} textarea rows={2} />
          <RunButton onClick={runExtract} busy={busy} busyLabel="Reading drawing sheet-by-sheet…">Extract to Table</RunButton>
          <ErrorNote>{error}</ErrorNote>
          {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Large multi-page drawings can take 30–90s as each sheet is interpreted.</div>}
        </Card>
      ) : (
        <Card title="2 · Validate against IRS Rules" desc="The drawing is read and checked against IRS (Indian Register of Shipping) class rules from the knowledge base.">
          <Field label="Focus (optional)" value={vFocus} onChange={setVFocus} placeholder="e.g. cable segregation, earthing, short-circuit protection" />
          <RunButton onClick={runValidate} busy={busy} busyLabel="Validating against IRS rules…">Validate Drawing</RunButton>
          <ErrorNote>{error}</ErrorNote>
        </Card>
      )}

      {mode === 'extract' && result && (
        <>
          <Card title="3 · Drawing Recognised">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatTile label="Rows" value={result.rowCount} tone="emerald" />
              <StatTile label="Sheets Read" value={result.meta?.pagesProcessed ?? '—'} tone="sky" />
              <StatTile label="Drawing No" value={tb.drawingNo || '—'} tone="violet" />
              <StatTile label={cad ? 'CAD' : 'Ship No'} value={cad ? (cad.kind?.toUpperCase() || 'CAD') : (tb.shipNo || '—')} tone="slate" />
              <StatTile label={cad ? 'Compartments' : 'Cable Types'} value={cad ? (cad.regions?.length || 0) : (cableLegend.length || '—')} tone="amber" />
            </div>
            {tb.title && <div className="text-[11px] text-slate-400">Title: <span className="text-slate-200">{tb.title}</span>{tb.system ? ` · System: ${tb.system}` : ''}</div>}
            {cad?.note && <div className="text-[10px] text-amber-400">{cad.note}</div>}
            {cableLegend.length > 0 && (
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-400">Cable legend resolved: </span>
                {cableLegend.map((c, i) => <span key={i} className="mr-2">[{c.ref}] {c.type || c.description}{c.size ? ` (${c.size})` : ''};</span>)}
              </div>
            )}
          </Card>

          <Card title="4 · Extracted Table">
            <ResultTable
              columns={result.columns}
              rows={result.rows}
              title={preset === 'Custom' ? 'Extracted data' : preset}
              sheetName={(preset === 'Custom' ? 'Extract' : preset).slice(0, 28)}
              downloadName={`${(tb.drawingNo || srcName || 'drawing').toString().replace(/\.[^.]+$/, '')}_${preset.replace(/[^a-z0-9]+/gi, '_')}`}
              note="Verify against the source drawing before issue. Empty cells indicate data not legible / not shown on the sheet."
            />
            <FeedbackBar module="drawings" subject={`${srcName} · ${preset}`} />
          </Card>
        </>
      )}

      {mode === 'validate' && vResult && (
        <Card title="3 · IRS Validation Findings" right={<span className="text-[11px] text-slate-400">{vResult.drawing}</span>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2">
            <StatTile label="Findings" value={vResult.total} tone="sky" />
            {(vResult.statuses || []).map(s => (
              <StatTile key={s} label={s} value={vResult.stats?.[s] || 0}
                tone={{ 'Compliant': 'emerald', 'Non-Compliant': 'red', 'Requires Review': 'amber' }[s] || 'slate'} />
            ))}
          </div>
          <ResultTable columns={V_HEAD} rows={vRows} title="IRS Validation" sheetName="IRS Validation"
            downloadName={`IRS_Validation_${(vResult.drawing || 'drawing').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
          {vResult.citations?.length > 0 && <div className="text-[10px] text-slate-500 mt-2">Grounded in: {vResult.citations.join(' · ')}</div>}
          <FeedbackBar module="drawings" subject={`IRS validation · ${vResult.drawing}`} />
        </Card>
      )}

      <ModuleChat
        module="drawings"
        title="Ask about this drawing"
        docText={source?.text}
        docName={source?.name}
        placeholder="e.g. What systems are shown on this SLD?"
        suggestions={[
          'What are the principal particulars shown on this GA?',
          'List the major equipment on this drawing.',
          'Does this drawing meet IRS cable-segregation requirements?',
        ]}
      />
    </Page>
  );
}
