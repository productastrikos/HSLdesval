import React, { useRef, useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, Field, Spinner } from '../components/feature/FeatureKit';
import { analyzeInspection } from '../services/featureApi';

const COLUMNS = ['slNo', 'reportRef', 'observation', 'type', 'category', 'system', 'discipline', 'severity', 'rootCause', 'recommendation', 'clauseRef'];
const HEADERS = ['Sl.No', 'Report Ref', 'Observation', 'Type', 'Category', 'System', 'Discipline', 'Severity', 'Root Cause', 'Recommendation / CAPA', 'Clause Ref'];

export default function InspectionReports() {
  const [file, setFile]       = useState(null);
  const [project, setProject] = useState('');
  const [save, setSave]       = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const fileRef = useRef(null);

  const run = async () => {
    if (!file) { setError('Select an inspection report first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await analyzeInspection({ file, project, saveToLessons: save });
      setResult(res);
      if (!res.observations?.length) setError('No observations were extracted from this report.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Map raw row objects to header-keyed rows for the table / Excel
  const rows = (result?.observations || []).map(o => {
    const r = {};
    COLUMNS.forEach((k, i) => { r[HEADERS[i]] = o[k] ?? ''; });
    return r;
  });

  return (
    <Page
      title="Inspection Report Converter"
      subtitle="Process inspection reports of any project — automatically extract observations, non-conformities and remarks, classify them (Material · Design/Drawing · Workmanship · Installation · Documentation · Testing & Commissioning) and export to Excel. Findings are added to the searchable Lessons-Learned repository."
    >
      <Card title="Upload Inspection Report" desc="PDF, scanned PDF, DOCX or image. Tag it with the project so lessons are organised project-wise.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setResult(null); setError(null); } }} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <span className="truncate">{file ? file.name : 'Select inspection report…'}</span>
            </button>
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
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Long reports are processed in sections.</div>}
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
          <Card title="Observations Register">
            <ResultTable
              columns={HEADERS}
              rows={rows}
              title={`${result.report}${result.project ? ' · ' + result.project : ''}`}
              sheetName="Observations"
              downloadName={`Inspection_${(result.project || result.report || 'report').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`}
            />
          </Card>
        </>
      )}
    </Page>
  );
}
