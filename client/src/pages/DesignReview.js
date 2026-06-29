import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { designReview, docFields } from '../services/featureApi';

const C_COLS = ['slNo', 'area', 'checkItem', 'reference', 'basis'];
const C_HEAD = ['Sl.No', 'Review Area', 'Check Item', 'Reference', 'Basis'];
const R_COLS = ['slNo', 'risk', 'category', 'likelihood', 'impact', 'recurring', 'preventiveMeasure', 'reference'];
const R_HEAD = ['Sl.No', 'Risk', 'Category', 'Likelihood', 'Impact', 'Recurring', 'Preventive Measure', 'Reference'];

function remap(items, keys, heads) {
  return (items || []).map(o => { const r = {}; keys.forEach((k, i) => { r[heads[i]] = o[k] ?? ''; }); return r; });
}

export default function DesignReview() {
  const [system, setSystem] = useState('');
  const [domain, setDomain] = useState('');
  const [scope, setScope]   = useState('');
  const [doc, setDoc]       = useState(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  const [res, setRes]       = useState(null);
  const [rtab, setRtab]     = useState('checklist');   // checklist | risk

  const run = async () => {
    if (!system.trim()) { setError('Enter the system to review.'); return; }
    setBusy(true); setError(null); setRes(null);
    try { setRes(await designReview({ system, domain, scope, ...docFields('doc', doc) })); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  const checklistRows = remap(res?.checklist, C_COLS, C_HEAD);
  const riskRows      = remap(res?.risks, R_COLS, R_HEAD);

  return (
    <Page
      title="Design Review Assistant"
      subtitle="Generate a system-wise design-review checklist tied to class rules and standards, plus a risk analysis informed by historical project data — highlighting recurring deficiencies and recommending preventive measures. Checklist and Risk Analysis are on separate tabs."
    >
      <Card title="Review Subject" desc="Name the system; optionally attach the design document under review.">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="System" value={system} onChange={setSystem} placeholder="e.g. MB/SRE broadcast system" />
          <Field label="Domain (optional)" value={domain} onChange={setDomain} placeholder="Electrical / Hull / HVAC / Piping…" />
          <Field label="Scope notes (optional)" value={scope} onChange={setScope} placeholder="e.g. focus on cable segregation & EMC" />
        </div>
        <DocSource label="Design document under review (optional)" value={doc} onChange={setDoc} />
        <RunButton onClick={run} busy={busy} busyLabel="Compiling checklist & risks…">Generate Design Review</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Cross-referencing rules and historical lessons for this system.</div>}
      </Card>

      {res && (
        <>
          <Card title="Summary">
            {res.systemInterpreted && res.resolvedSystem && (
              <div className="text-[11px] text-amber-300/90 bg-amber-500/[0.08] border border-amber-500/25 rounded-lg px-3 py-1.5 mb-1">
                Read “{res.system}” as <span className="font-semibold">{res.resolvedSystem}</span> to match historical lessons. If that’s not the system you meant, refine the name and re-run.
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <StatTile label="Checklist Items" value={res.checklistCount} tone="sky" />
              <StatTile label="Risks Identified" value={res.riskCount} tone="amber" />
              <StatTile label="Lessons Used" value={res.lessonsUsed} tone="emerald" />
              <StatTile label="Recurring Defects" value={res.recurringCount} tone="red" />
            </div>
            {res.citations?.length > 0 && <div className="text-[10px] text-slate-500">Grounded in: {res.citations.join(' · ')}</div>}
          </Card>

          <div className="flex gap-1.5">
            <button onClick={() => setRtab('checklist')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${rtab === 'checklist' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Checklist ({res.checklistCount || 0})</button>
            <button onClick={() => setRtab('risk')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${rtab === 'risk' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Risk Analysis ({res.riskCount || 0})</button>
          </div>

          {rtab === 'checklist' ? (
            <Card title="Design-Review Checklist">
              <ResultTable columns={C_HEAD} rows={checklistRows} title="Design-Review Checklist" sheetName="Checklist"
                downloadName={`DesignReview_Checklist_${system.replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
              <FeedbackBar module="designreview" subject={`Checklist · ${system}`} />
            </Card>
          ) : (
            <Card title="Risk Analysis">
              <ResultTable columns={R_HEAD} rows={riskRows} title="Risk Analysis" sheetName="Risk Analysis"
                downloadName={`DesignReview_RiskAnalysis_${system.replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`}
                note={riskRows.length ? '' : 'No risks were identified for this system.'} />
              <FeedbackBar module="designreview" subject={`Risk analysis · ${system}`} />
            </Card>
          )}
        </>
      )}

      <ModuleChat
        module="designreview"
        title="Ask about the design review"
        docText={doc?.text}
        docName={doc?.name}
        placeholder="e.g. What are the top recurring risks for this system?"
        suggestions={[
          'What are the most common design deficiencies for this system?',
          'List preventive measures for the top risks.',
          'Which class rules apply to this system?',
        ]}
      />
    </Page>
  );
}
