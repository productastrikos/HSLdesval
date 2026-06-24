import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { prebidQueries, docFields } from '../services/featureApi';

const COLS = ['slNo', 'clauseRef', 'pageNumber', 'clauseDescription', 'category', 'query', 'rationale', 'risk'];
const HEAD = ['Sl.No', 'Clause / Ref', 'Page Number', 'Clause Description', 'Category', 'Pre-Bid Query', 'Rationale', 'Risk'];

export default function PreBidQueries() {
  const [rfp, setRfp]     = useState(null);
  const [focus, setFocus] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);

  const run = async () => {
    if (!rfp) { setError('Provide the RFP / tender / build specification document.'); return; }
    setBusy(true); setError(null); setRes(null);
    try { setRes(await prebidQueries({ focus, ...docFields('rfp', rfp) })); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  const rows = (res?.queries || []).map(o => { const r = {}; COLS.forEach((k, i) => { r[HEAD[i]] = o[k] ?? ''; }); return r; });

  return (
    <Page
      title="Pre-Bid Query Generation"
      subtitle="Analyse an RFP / tender / Build Specification against historical lessons and applicable rules, and automatically generate pre-bid queries — surfacing ambiguities, contradictions, missing information, impractical requirements and execution risks. The Excel download includes Page Number and Clause Description columns."
    >
      <Card title="RFP / Tender / Build Specification" desc="Pick the document (e.g. the pre-loaded Build Specification of Tugs) or one you uploaded.">
        <DocSource label="RFP / Tender / Build Spec" value={rfp} onChange={setRfp} />
        <Field label="Bid focus (optional)" value={focus} onChange={setFocus} placeholder="e.g. electrical scope, propulsion, hull outfitting" />
        <RunButton onClick={run} busy={busy} busyLabel="Analysing document…">Generate Pre-Bid Queries</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading section-by-section for ambiguities, contradictions and risks (with page numbers).</div>}
      </Card>

      {res && (
        <>
          <Card title="Query Summary" right={<span className="text-[11px] text-slate-400">{res.rfp}</span>}>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              <StatTile label="Total Queries" value={res.total} tone="emerald" />
              {Object.entries(res.byCategory).filter(([, v]) => v > 0).slice(0, 8).map(([k, v]) => (
                <StatTile key={k} label={k} value={v} tone="sky" />
              ))}
            </div>
          </Card>
          <Card title="Pre-Bid Queries">
            <ResultTable columns={HEAD} rows={rows} title="Pre-Bid Queries" sheetName="Pre-Bid Queries"
              downloadName={`PreBidQueries_${(res.rfp || 'rfp').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
            {res.citations?.length > 0 && <div className="text-[10px] text-slate-500 mt-2">Grounded in: {res.citations.join(' · ')}</div>}
            <FeedbackBar module="prebid" subject={res.rfp} />
          </Card>
        </>
      )}

      <ModuleChat
        module="prebid"
        title="Ask about this RFP / specification"
        docText={rfp?.text}
        docName={rfp?.name}
        placeholder="e.g. What are the riskiest clauses to clarify before bidding?"
        suggestions={[
          'List the most critical ambiguities in this document.',
          'What information is missing that we must request?',
          'Which requirements look technically impractical?',
        ]}
      />
    </Page>
  );
}
