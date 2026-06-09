import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner } from '../components/feature/FeatureKit';
import { analyzeInspection } from '../services/featureApi';

const COLUMNS = ['slNo', 'reportRef', 'observation', 'type', 'category', 'system', 'discipline', 'severity', 'rootCause', 'recommendation', 'clauseRef'];
const HEADERS = ['Sl.No', 'Report Ref', 'Observation', 'Type', 'Category', 'System', 'Discipline', 'Severity', 'Root Cause', 'Recommendation / CAPA', 'Clause Ref'];

export default function InspectionReports() {
  const [doc, setDoc]         = useState(null);
  const [project, setProject] = useState('');
  const [save, setSave]       = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);

  const run = async () => {
    if (!doc) { setError('Select an inspection report first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await analyzeInspection({ text: doc.text, name: doc.name, project, saveToLessons: save });
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
      <Card title="Select Inspection Report" desc="Choose a document you uploaded on the Documents page. Tag it with the project so lessons are organised project-wise.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <DocSource label="Inspection Report" value={doc} onChange={(v) => { setDoc(v); setResult(null); setError(null); }} />
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
