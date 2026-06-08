import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner } from '../components/feature/FeatureKit';
import { prebidQueries, docFields } from '../services/featureApi';

const COLS = ['slNo', 'clauseRef', 'category', 'query', 'rationale', 'risk'];
const HEAD = ['Sl.No', 'Clause / Ref', 'Category', 'Pre-Bid Query', 'Rationale', 'Risk'];

export default function PreBidQueries() {
  const [rfp, setRfp]     = useState(null);
  const [focus, setFocus] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);

  const run = async () => {
    if (!rfp) { setError('Provide the RFP / tender document.'); return; }
    setBusy(true); setError(null); setRes(null);
    try { setRes(await prebidQueries({ focus, ...docFields('rfp', rfp) })); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  const rows = (res?.queries || []).map(o => { const r = {}; COLS.forEach((k, i) => { r[HEAD[i]] = o[k] ?? ''; }); return r; });

  return (
    <Page
      title="Pre-Bid Query Generation"
      subtitle="Analyse an RFP / tender — specifications, standards and contractual requirements — against historical lessons and applicable rules, and automatically generate technically relevant pre-bid queries. Surfaces ambiguities, contradictions, missing information, impractical requirements and execution risks."
    >
      <Card title="RFP / Tender Document" desc="Upload the RFP (any open-source ship RFP works for a demo) or pick from the knowledge base.">
        <DocSource label="RFP / Tender" value={rfp} onChange={setRfp} />
        <Field label="Bid focus (optional)" value={focus} onChange={setFocus} placeholder="e.g. electrical scope, propulsion, hull outfitting" />
        <RunButton onClick={run} busy={busy} busyLabel="Analysing RFP…">Generate Pre-Bid Queries</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading the RFP section-by-section for ambiguities, contradictions and risks.</div>}
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
          </Card>
        </>
      )}
    </Page>
  );
}
