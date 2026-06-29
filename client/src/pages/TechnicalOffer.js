import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, MultiDocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { complianceMatrix } from '../services/featureApi';

const M_COLS = ['slNo', 'clauseRef', 'requirement', 'offerResponse', 'status', 'deviation', 'remarks'];
const M_HEAD = ['Sl.No', 'Clause Ref', 'TTS Requirement', 'Offer Response', 'Status', 'Deviation / Exclusion / Assumption', 'Remarks'];
const Q_COLS = ['slNo', 'clauseRef', 'category', 'query', 'rationale'];
const Q_HEAD = ['Sl.No', 'Clause Ref', 'Category', 'Technical Query', 'Rationale'];
const R_COLS = ['slNo', 'clauseRef', 'recommendation', 'action', 'priority'];
const R_HEAD = ['Sl.No', 'Clause Ref', 'Recommendation', 'Action', 'Priority'];

function remap(items, keys, heads) {
  return (items || []).map(o => { const r = {}; keys.forEach((k, i) => { r[heads[i]] = o[k] ?? ''; }); return r; });
}

// Build a vendor-wise comparison matrix: one row per TTS requirement, one column
// per offer, showing each vendor's compliance status side-by-side (Part-E #5).
function buildComparison(results) {
  const offers = results.map(r => r.offer);
  const map = new Map();
  results.forEach(r => {
    (r.matrix || []).forEach(m => {
      const key = (m.clauseRef && m.clauseRef.trim())
        ? `c:${m.clauseRef.trim().toLowerCase()}`
        : `r:${(m.requirement || '').trim().toLowerCase().slice(0, 80)}`;
      if (!map.has(key)) map.set(key, { clauseRef: m.clauseRef || '', requirement: m.requirement || '', byOffer: {} });
      map.get(key).byOffer[r.offer] = m.status || '';
    });
  });
  const columns = ['Clause Ref', 'TTS Requirement', ...offers];
  const rows = [...map.values()].map(v => {
    const row = { 'Clause Ref': v.clauseRef, 'TTS Requirement': v.requirement };
    offers.forEach(o => { row[o] = v.byOffer[o] || '—'; });
    return row;
  });
  return { columns, rows };
}

function OfferResult({ system, r }) {
  const matrixRows = remap(r.matrix, M_COLS, M_HEAD);
  const queryRows  = remap(r.queries, Q_COLS, Q_HEAD);
  const recRows    = remap(r.recommendations, R_COLS, R_HEAD);
  const slug = (r.offer || 'offer').replace(/[^a-z0-9]+/gi, '_').slice(0, 24);
  return (
    <Card title={`Offer: ${r.offer}`} right={<span className="text-[11px] text-emerald-400 font-bold">{r.compliancePct}% compliant</span>}>
      <div className="grid grid-cols-3 md:grid-cols-7 gap-2.5">
        <StatTile label="Compliance" value={`${r.compliancePct}%`} tone="emerald" />
        <StatTile label="Total" value={r.total} tone="sky" />
        {Object.entries(r.stats || {}).map(([s, v]) => <StatTile key={s} label={s} value={v}
          tone={{ 'Complied': 'emerald', 'Partially Complied': 'amber', 'Deviation': 'orange', 'Exclusion': 'red', 'Not Addressed': 'red', 'Ambiguous': 'violet' }[s] || 'slate'} />)}
      </div>
      <ResultTable columns={M_HEAD} rows={matrixRows} title="Technical Compliance Matrix" sheetName="Compliance Matrix"
        downloadName={`Compliance_${slug}`}
        extraSheets={[{ name: 'Technical Queries', columns: Q_HEAD, rows: queryRows }, { name: 'Recommendations', columns: R_HEAD, rows: recRows }]}
        note="The Excel download also includes the technical queries and the explicit recommendations sheets." />
      {recRows.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-white">Recommendations (explicit actions — e.g. “Seek this document from the vendor”)</div>
          <ResultTable columns={R_HEAD} rows={recRows} title="Recommendations" sheetName="Recommendations" downloadName={`Recommendations_${slug}`} />
        </div>
      )}
      <FeedbackBar module="compliance" subject={`${system} · ${r.offer}`} />
    </Card>
  );
}

export default function TechnicalOffer() {
  const [tts, setTts]       = useState(null);
  const [offers, setOffers] = useState([]);
  const [system, setSystem] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  const [res, setRes]       = useState(null);

  const run = async () => {
    if (!tts || !offers.length) { setError('Provide the TTS/SOTR and at least one vendor technical offer.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      setRes(await complianceMatrix({
        system,
        ttsText: tts.text, ttsName: tts.name,
        offers: offers.map(o => ({ name: o.name, text: o.text })),
      }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <Page
      title="Technical Offer Evaluation"
      subtitle="Review one or MORE vendor technical offers against the Tender Technical Specification (TTS / SOTR). Auto-prepare a clause-by-clause Technical Compliance Matrix, flag deviations / exclusions / ambiguities, generate vendor queries, and produce explicit recommendations (e.g. “Seek this document from the vendor”) in the Excel output."
    >
      <Card title="Documents" desc="Provide the TTS/SOTR and one or more vendor technical offers (select multiple to compare).">
        <div className="grid md:grid-cols-2 gap-5">
          <DocSource label="Tender Technical Specification (TTS / SOTR)" value={tts} onChange={setTts} />
          <MultiDocSource label="Vendor Technical Offer(s)" values={offers} onChange={setOffers} />
        </div>
        <Field label="System (optional)" value={system} onChange={setSystem} placeholder="e.g. HDCS / DGPS / EM Log" />
        <RunButton onClick={run} busy={busy} busyLabel="Building compliance matrices…">{offers.length > 1 ? `Evaluate ${offers.length} Offers` : 'Generate Compliance Matrix'}</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Each TTS section is assessed against every offer — this can take a minute.</div>}
      </Card>

      {res && (
        <>
          <div className="text-[11px] text-slate-400">TTS: <span className="text-slate-200">{res.tts}</span> · {res.offerCount} offer{res.offerCount === 1 ? '' : 's'} evaluated</div>
          {res.results.length > 1 && (() => {
            const cmp = buildComparison(res.results);
            return (
              <Card title="Vendor-wise Compliance Comparison" desc="Each TTS requirement against every vendor offer, side-by-side. Copy for Excel or export.">
                <ResultTable columns={cmp.columns} rows={cmp.rows}
                  title="Vendor-wise Compliance" sheetName="Vendor Comparison"
                  downloadName={`Vendor_Compliance_${(res.system || 'offers').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
                <FeedbackBar module="compliance" subject={`Vendor comparison · ${res.system || res.tts}`} />
              </Card>
            );
          })()}
          {res.results.map((r, i) => <OfferResult key={i} system={res.system} r={r} />)}
          {res.citations?.length > 0 && <div className="text-[10px] text-slate-500">Grounded in: {res.citations.join(' · ')}</div>}
        </>
      )}

      <ModuleChat
        module="compliance"
        title="Ask about the offer scrutiny"
        docText={tts?.text}
        docName={tts?.name}
        placeholder="e.g. Which offer best meets the redundancy requirement?"
        suggestions={[
          'What documents should we seek from the vendor before award?',
          'Summarise the key deviations across the offers.',
          'Which requirements are not addressed by any offer?',
        ]}
      />
    </Page>
  );
}
