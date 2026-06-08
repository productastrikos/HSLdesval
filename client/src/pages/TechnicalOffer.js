import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner } from '../components/feature/FeatureKit';
import { complianceMatrix, docFields } from '../services/featureApi';

const M_COLS = ['slNo', 'clauseRef', 'requirement', 'offerResponse', 'status', 'deviation', 'remarks'];
const M_HEAD = ['Sl.No', 'Clause Ref', 'TTS Requirement', 'Offer Response', 'Status', 'Deviation / Exclusion / Assumption', 'Remarks'];
const Q_COLS = ['slNo', 'clauseRef', 'category', 'query', 'rationale'];
const Q_HEAD = ['Sl.No', 'Clause Ref', 'Category', 'Technical Query', 'Rationale'];

function remap(items, keys, heads) {
  return (items || []).map(o => { const r = {}; keys.forEach((k, i) => { r[heads[i]] = o[k] ?? ''; }); return r; });
}

export default function TechnicalOffer() {
  const [tts, setTts]     = useState(null);
  const [offer, setOffer] = useState(null);
  const [system, setSystem] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);

  const run = async () => {
    if (!tts || !offer) { setError('Provide both the TTS/SOTR and the vendor technical offer.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      setRes(await complianceMatrix({ system, ...docFields('tts', tts), ...docFields('offer', offer) }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const matrixRows = remap(res?.matrix, M_COLS, M_HEAD);
  const queryRows  = remap(res?.queries, Q_COLS, Q_HEAD);

  return (
    <Page
      title="Technical Offer Scrutiny"
      subtitle="Review a vendor technical offer against the Tender Technical Specification (TTS / SOTR). Auto-prepare a clause-by-clause Technical Compliance Matrix, flag deviations / exclusions / assumptions / ambiguities / non-compliances, and generate technical queries for the vendor."
    >
      <Card title="Documents" desc="Provide the TTS/SOTR and the vendor's technical offer (upload, or pick from the knowledge base).">
        <div className="grid md:grid-cols-2 gap-5">
          <DocSource label="Tender Technical Specification (TTS / SOTR)" value={tts} onChange={setTts} />
          <DocSource label="Vendor Technical Offer" value={offer} onChange={setOffer} />
        </div>
        <Field label="System (optional)" value={system} onChange={setSystem} placeholder="e.g. HDCS / DGPS / EM Log" />
        <RunButton onClick={run} busy={busy} busyLabel="Building compliance matrix…">Generate Compliance Matrix</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Each TTS section is assessed against the offer — this can take a minute.</div>}
      </Card>

      {res && (
        <>
          <Card title="Compliance Summary" right={<span className="text-[11px] text-slate-400">{res.tts} vs {res.offer}</span>}>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2.5">
              <StatTile label="Compliance" value={`${res.compliancePct}%`} tone="emerald" />
              <StatTile label="Total" value={res.total} tone="sky" />
              {res.statuses.map(s => <StatTile key={s} label={s} value={res.stats[s] || 0}
                tone={{ 'Complied': 'emerald', 'Partially Complied': 'amber', 'Deviation': 'orange', 'Exclusion': 'red', 'Not Addressed': 'red', 'Ambiguous': 'violet' }[s] || 'slate'} />)}
            </div>
          </Card>

          <Card title="Technical Compliance Matrix">
            <ResultTable columns={M_HEAD} rows={matrixRows} title="Compliance Matrix" sheetName="Compliance Matrix"
              downloadName={`Compliance_${(system || res.offer || 'offer').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`}
              extraSheets={[{ name: 'Technical Queries', columns: Q_HEAD, rows: queryRows }]}
              note="The Excel download includes a second sheet with the technical queries." />
          </Card>

          {queryRows.length > 0 && (
            <Card title="Technical Queries for Vendor">
              <ResultTable columns={Q_HEAD} rows={queryRows} title="Technical Queries" sheetName="Technical Queries"
                downloadName={`Queries_${(system || res.offer || 'offer').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
