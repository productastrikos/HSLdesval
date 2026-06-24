import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner, Pill, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { analyzeInspection, inspectionAnalytics, listInspectionObservations, updateInspectionObservation } from '../services/featureApi';

const COLUMNS = ['slNo', 'reportRef', 'observation', 'type', 'category', 'system', 'severity', 'satUnsat', 'status', 'recommendation', 'clauseRef'];
const HEADERS = ['Sl.No', 'Report Ref', 'Observation', 'Type', 'Category', 'Equipment / System', 'Severity', 'SAT/UNSAT', 'Status', 'Recommendation / CAPA', 'Clause Ref'];

function Bar({ label, value, max, tone = 'sky' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = { sky: 'bg-sky-500', amber: 'bg-amber-500', red: 'bg-red-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500' }[tone];
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className="w-40 truncate text-slate-300" title={label}>{label}</div>
      <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <div className="w-8 text-right text-slate-400 font-mono">{value}</div>
    </div>
  );
}

// One status-trackable observation row with an inline "close remark" form.
function ObsRow({ o, onChanged }) {
  const [open, setOpen]   = useState(false);
  const [remark, setRemark] = useState(o.closureRemark || '');
  const [busy, setBusy]   = useState(false);
  const setStatus = async (status) => {
    setBusy(true);
    try { await updateInspectionObservation(o.id, { status, closureRemark: remark }); onChanged && onChanged(); }
    catch (_) {}
    setBusy(false); setOpen(false);
  };
  return (
    <div className="p-3 hover:bg-white/[0.02]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Pill value={o.severity}>{o.severity}</Pill>
            <Pill value={o.category}>{o.category}</Pill>
            {o.satUnsat && <Pill value={o.satUnsat === 'UNSAT' ? 'no' : 'complied'}>{o.satUnsat}</Pill>}
            <span className="text-[10px] font-mono text-slate-500">{o.system || 'Unspecified'}</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-snug">{o.observation}</p>
          {o.closureRemark && <p className="text-[10px] text-emerald-400 mt-1">Closure: {o.closureRemark}</p>}
        </div>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${o.status === 'Closed' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>{o.status}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {o.status === 'Open' ? (
          open ? (
            <div className="flex-1 flex items-center gap-2">
              <input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Closure remark (optional)…"
                className="flex-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-200" />
              <button onClick={() => setStatus('Closed')} disabled={busy} className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 disabled:opacity-40">{busy ? '…' : 'Confirm Close'}</button>
              <button onClick={() => setOpen(false)} className="text-[10px] px-2 py-1 rounded text-slate-400">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setOpen(true)} className="text-[10px] px-2 py-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">Close remark</button>
          )
        ) : (
          <button onClick={() => setStatus('Open')} disabled={busy} className="text-[10px] px-2 py-1 rounded text-slate-400 hover:text-white">Re-open</button>
        )}
      </div>
    </div>
  );
}

export default function InspectionReports() {
  const [tab, setTab]         = useState('analyze');
  const [doc, setDoc]         = useState(null);
  const [file, setFile]       = useState(null);
  const [project, setProject] = useState('');
  const [save, setSave]       = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const fileRef = useRef(null);

  // analytics + open remarks
  const [analytics, setAnalytics] = useState(null);
  const [obs, setObs]             = useState([]);
  const [obsFilter, setObsFilter] = useState('Open');

  const refreshAnalytics = useCallback(() => { inspectionAnalytics().then(setAnalytics).catch(() => {}); }, []);
  const refreshObs = useCallback(() => {
    const params = obsFilter === 'All' ? {} : { status: obsFilter };
    listInspectionObservations(params).then(r => setObs(r.observations || [])).catch(() => setObs([]));
  }, [obsFilter]);

  useEffect(() => { if (tab === 'analytics') refreshAnalytics(); if (tab === 'remarks') refreshObs(); }, [tab, refreshAnalytics, refreshObs]);

  const onUpload = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFile(f); setDoc(null); setResult(null); setError(null); } };

  const run = async () => {
    if (!file && !doc) { setError('Select a report, or upload one (including a handwritten image).'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = file
        ? await analyzeInspection({ file, project, saveToLessons: save })
        : await analyzeInspection({ text: doc.text, name: doc.name, project, saveToLessons: save });
      setResult(res);
      if (!res.observations?.length) setError('No observations were extracted from this report.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const rows = (result?.observations || []).map(o => { const r = {}; COLUMNS.forEach((k, i) => { r[HEADERS[i]] = o[k] ?? ''; }); return r; });
  const maxEq = analytics?.equipment?.reduce((m, e) => Math.max(m, e.total), 0) || 0;
  const tabCls = (t) => `px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${tab === t ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'text-slate-400 hover:text-white border-transparent'}`;

  return (
    <Page
      title="Inspection Reports Analytics"
      subtitle="Process inspection reports / NCRs / trial reports — including handwritten report images (vision OCR) — auto-classify every observation, track status (close open remarks), and view an equipment-wise analytics dashboard. Findings feed the Lessons-Learned repository."
    >
      <div className="flex gap-1 bg-app-panel border border-app-border rounded-xl p-1 w-fit">
        <button className={tabCls('analyze')} onClick={() => setTab('analyze')}>Analyse Report</button>
        <button className={tabCls('analytics')} onClick={() => setTab('analytics')}>Analytics Dashboard</button>
        <button className={tabCls('remarks')} onClick={() => setTab('remarks')}>Status Tracking</button>
      </div>

      {tab === 'analyze' && (
        <>
          <Card title="Select / Upload Inspection Report" desc="Choose a document, or upload a report — including a handwritten inspection image (PNG/JPG) which is read by the vision model.">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <DocSource label="Inspection Report" value={doc} onChange={(v) => { setDoc(v); setFile(null); setResult(null); setError(null); }} />
                <div>
                  <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.tiff,.bmp,.webp" className="hidden" onChange={onUpload} />
                  <button onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    {file ? file.name : 'Upload report / handwritten image'}
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                <Field label="Project" value={project} onChange={setProject} placeholder="e.g. Yard 11190-91 / DSV" />
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} className="accent-sky-500" />
                  Add findings to the Lessons-Learned repository
                </label>
              </div>
            </div>
            <RunButton onClick={run} busy={busy} busyLabel="Extracting & classifying observations…">Analyse Report</RunButton>
            <ErrorNote>{error}</ErrorNote>
            {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Long / handwritten reports are processed in sections.</div>}
          </Card>

          {result && (
            <>
              <Card title="Classification Summary" right={result.savedToLessons ? <span className="text-[10px] text-emerald-400">✓ {result.savedToLessons} added to Lessons-Learned</span> : null}>
                <div className="grid grid-cols-3 md:grid-cols-7 gap-2.5">
                  <StatTile label="Total" value={result.total} tone="emerald" />
                  {result.categories.map(c => (
                    <StatTile key={c} label={c.replace('Testing and Commissioning', 'Testing & Comm.')} value={result.byCategory[c] || 0}
                      tone={{ 'Material': 'amber', 'Design/Drawing': 'violet', 'Workmanship': 'orange', 'Installation': 'sky', 'Documentation': 'slate', 'Testing and Commissioning': 'red' }[c] || 'sky'} />
                  ))}
                </div>
              </Card>
              <Card title="Observations Register" desc="Classified, status-tracked and downloadable. Close open remarks in the Status Tracking tab.">
                <ResultTable columns={HEADERS} rows={rows} title={`${result.report}${result.project ? ' · ' + result.project : ''}`} sheetName="Observations"
                  downloadName={`Inspection_${(result.project || result.report || 'report').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
                <FeedbackBar module="inspection" subject={result.report} />
              </Card>
            </>
          )}
        </>
      )}

      {tab === 'analytics' && (
        <>
          <Card title="Equipment-wise Analytics" right={<button onClick={refreshAnalytics} className="text-[10px] px-2 py-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">Refresh</button>}
            desc="Aggregated from all analysed inspection reports. Nothing is pre-populated — analyse reports to build this view.">
            {!analytics || analytics.total === 0 ? (
              <div className="text-[11px] text-slate-500 py-6 text-center">No inspection data yet. Analyse a report to populate equipment-wise analytics.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <StatTile label="Total Observations" value={analytics.total} tone="sky" />
                  <StatTile label="Open" value={analytics.open} tone="red" />
                  <StatTile label="Closed" value={analytics.closed} tone="emerald" />
                  <StatTile label="UNSAT" value={analytics.unsat} tone="amber" />
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-2">
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">By Equipment (total observations)</div>
                    {analytics.equipment.slice(0, 12).map(e => <Bar key={e.equipment} label={e.equipment} value={e.total} max={maxEq} tone="sky" />)}
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">By Category</div>
                    {analytics.categories.map(c => <Bar key={c} label={c} value={analytics.byCategory[c] || 0} max={Math.max(...analytics.categories.map(x => analytics.byCategory[x] || 0), 1)} tone="violet" />)}
                  </div>
                </div>
              </>
            )}
          </Card>
          {analytics && analytics.equipment?.length > 0 && (
            <Card title="Equipment Register">
              <ResultTable
                columns={['Equipment / System', 'Total', 'Open', 'Closed', 'Critical', 'High', 'UNSAT']}
                rows={analytics.equipment.map(e => ({ 'Equipment / System': e.equipment, Total: e.total, Open: e.open, Closed: e.closed, Critical: e.critical, High: e.high, UNSAT: e.unsat }))}
                title="Equipment-wise Analytics" sheetName="Equipment Analytics" downloadName="Inspection_Equipment_Analytics" />
            </Card>
          )}
        </>
      )}

      {tab === 'remarks' && (
        <Card title="Status Tracking — Open / Closed Remarks" right={
          <div className="flex items-center gap-1">
            {['Open', 'Closed', 'All'].map(f => (
              <button key={f} onClick={() => setObsFilter(f)} className={`text-[10px] px-2 py-1 rounded border font-semibold ${obsFilter === f ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{f}</button>
            ))}
          </div>
        } desc="Track and close remarks raised across inspection reports.">
          <div className="rounded-lg border border-app-border divide-y divide-white/[0.04] max-h-[60vh] overflow-y-auto">
            {obs.length === 0 ? (
              <div className="text-[11px] text-slate-500 py-8 text-center">No {obsFilter !== 'All' ? obsFilter.toLowerCase() : ''} remarks. Analyse an inspection report first.</div>
            ) : obs.map(o => <ObsRow key={o.id} o={o} onChanged={() => { refreshObs(); }} />)}
          </div>
        </Card>
      )}

      <ModuleChat
        module="inspection"
        title="Ask about inspections"
        docText={doc?.text}
        docName={doc?.name}
        placeholder="e.g. Which equipment has the most open non-conformities?"
        suggestions={[
          'Summarise the recurring defects across inspection reports.',
          'Which equipment has the most critical observations?',
          'Draft a corrective action plan for the open remarks.',
        ]}
      />
    </Page>
  );
}
