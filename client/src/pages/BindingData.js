import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, Field, Spinner } from '../components/feature/FeatureKit';
import { bindingGap, docFields } from '../services/featureApi';

const G_COLS = ['slNo', 'item', 'itemType', 'potsRef', 'status', 'finding', 'actionRequired'];
const G_HEAD = ['Sl.No', 'Required Item', 'Type', 'POTS Ref', 'Status', 'Finding', 'Action Required Before Approval'];
const R_COLS = ['slNo', 'point', 'category', 'priority', 'rationale'];
const R_HEAD = ['Sl.No', 'Point to Seek from Vendor', 'Category', 'Priority', 'Rationale'];

function remap(items, keys, heads) {
  return (items || []).map(o => { const r = {}; keys.forEach((k, i) => { r[heads[i]] = o[k] ?? ''; }); return r; });
}

export default function BindingData() {
  const [pots, setPots]       = useState(null);
  const [binding, setBinding] = useState(null);
  const [system, setSystem]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [res, setRes]         = useState(null);

  const run = async () => {
    if (!pots || !binding) { setError('Provide both the POTS and the vendor binding data.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      setRes(await bindingGap({ system, ...docFields('pots', pots), ...docFields('binding', binding) }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const gapRows = remap(res?.gaps, G_COLS, G_HEAD);
  const recRows = remap(res?.recommendations, R_COLS, R_HEAD);

  return (
    <Page
      title="Vendor Binding Data Review"
      subtitle="Review vendor binding data / technical submissions against the Purchase Order Technical Specification (POTS). Identify missing or inadequate drawings, calculations, certificates, manuals, test procedures and compliance documents, and get the specific points to seek from the vendor before approval."
    >
      <Card title="Documents" desc="Provide the POTS and the vendor's binding-data submission.">
        <div className="grid md:grid-cols-2 gap-5">
          <DocSource label="Purchase Order Technical Specification (POTS)" value={pots} onChange={setPots} />
          <DocSource label="Vendor Binding Data" value={binding} onChange={setBinding} />
        </div>
        <Field label="System (optional)" value={system} onChange={setSystem} placeholder="e.g. MB/SRE" />
        <RunButton onClick={run} busy={busy} busyLabel="Running gap analysis…">Run Gap Analysis</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Deriving required deliverables from the POTS and checking the submission.</div>}
      </Card>

      {res && (
        <>
          <Card title="Completeness Summary" right={<span className="text-[11px] text-slate-400">{res.pots} vs {res.binding}</span>}>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
              <StatTile label="Completeness" value={`${res.completeness}%`} tone="emerald" />
              <StatTile label="Required Items" value={res.total} tone="sky" />
              {res.statuses.map(s => <StatTile key={s} label={s} value={res.stats[s] || 0}
                tone={{ 'Submitted': 'emerald', 'Partial': 'amber', 'Insufficient': 'orange', 'Missing': 'red' }[s] || 'slate'} />)}
            </div>
          </Card>

          <Card title="Gap-Analysis Report">
            <ResultTable columns={G_HEAD} rows={gapRows} title="Gap Analysis" sheetName="Gap Analysis"
              downloadName={`BindingGap_${(system || res.binding || 'binding').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`}
              extraSheets={[{ name: 'Recommendations', columns: R_HEAD, rows: recRows }]}
              note="The Excel download includes a second sheet with the recommended points to seek from the vendor." />
          </Card>

          {recRows.length > 0 && (
            <Card title="Points to Seek Before Approval">
              <ResultTable columns={R_HEAD} rows={recRows} title="Recommendations" sheetName="Recommendations"
                downloadName={`BindingRecommendations_${(system || 'binding').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
