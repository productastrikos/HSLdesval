import React, { useState } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { bomGenerate, costEstimate, costEnquiries, costUpdate, downloadWord, downloadPdf, logInteraction } from '../services/featureApi';

const BOM_COLS = 'Discipline, System, Equipment Name, OEM, Capacity, Unit, Quantity, Reference';
const fmt = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');

export default function ShipCost() {
  const [sources, setSources] = useState([]);
  const [project, setProject] = useState('');
  const [busy, setBusy]       = useState(false);
  const [stage, setStage]     = useState('');
  const [error, setError]     = useState(null);

  const [bom, setBom]         = useState(null);     // { columns, rows }
  const [est, setEst]         = useState(null);     // estimate result
  const [enq, setEnq]         = useState(null);     // enquiries result
  const [openEnq, setOpenEnq] = useState(null);

  // Estimation parameters that drive the prescribed cost-template columns.
  const [overheadPct, setOverheadPct]           = useState('20');
  const [escalationRate, setEscalationRate]     = useState('5');
  const [escalationPeriod, setEscalationPeriod] = useState('1.5');
  const [usdRate, setUsdRate]                   = useState('84');
  const [deliveryMonths, setDeliveryMonths]     = useState('18');
  const estParams = () => ({
    overheadPct: Number(overheadPct) || 0, escalationRate: Number(escalationRate) || 0,
    escalationPeriod: Number(escalationPeriod) || 0, usdRate: Number(usdRate) || 1, deliveryMonths: Number(deliveryMonths) || 0,
  });

  // sample BQ update
  const [bqItem, setBqItem]   = useState('');
  const [bqVendor, setBqVendor] = useState('');
  const [bqRate, setBqRate]   = useState('');
  const [bqs, setBqs]         = useState([]);

  const run = async () => {
    if (!sources.length) { setError('Select at least one source (RFP / Build Specification).'); return; }
    setBusy(true); setError(null); setBom(null); setEst(null); setEnq(null); setBqs([]);
    try {
      setStage('Generating Bill of Materials…');
      const columns = BOM_COLS.split(',').map(s => s.trim());
      const b = await bomGenerate({ sources: sources.map(s => ({ name: s.name, text: s.text })),
        prompt: 'Generate a system-wise and discipline-wise BOM for ship cost estimation. Include Discipline, System, Equipment Name, Capacity and Quantity.', columns });
      if (!b.rows?.length) { setError('No BOM items were generated from these sources.'); setBusy(false); return; }
      setBom(b);
      setStage('Estimating cost with representative rates…');
      const e = await costEstimate({ bom: b.rows, columns: b.columns, project, params: estParams() });
      setEst(e);
      setStage('Identifying approved vendors & preparing BQ enquiries…');
      const q = await costEnquiries({ bom: b.rows, columns: b.columns, project });
      setEnq(q);
      logInteraction({ module: 'Ship Cost Estimation', prompt: `Estimate cost for ${project || 'project'}`, subject: sources.map(s => s.name).join(', '),
        response: `Preliminary estimate ${e.totalFmt} across ${e.items.length} items; ${q.vendorCount} vendor BQ enquiries prepared.` }).catch(() => {});
    } catch (e) { setError(e.message); }
    setBusy(false); setStage('');
  };

  const addBq = () => {
    if (!bqItem.trim() || !bqRate) return;
    setBqs([...bqs, { item: bqItem.trim(), vendor: bqVendor.trim(), rate: Number(bqRate) }]);
    setBqItem(''); setBqVendor(''); setBqRate('');
  };
  const applyBqs = async () => {
    if (!bom || !bqs.length) return;
    setBusy(true); setError(null);
    try { setEst(await costUpdate({ bom: bom.rows, columns: bom.columns, bqs, project, params: estParams() })); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Prescribed HSL ship-cost estimate format.
  const COST_COLS = [
    'S.No', 'Equipment', 'Qty', 'Unit cost', 'Is it from LPP/BQ', 'Reference of cost (LPP / BQ)',
    'LPP Delivery date / BQ Validity or Delivery Date', 'Indg/Import', 'Currency', 'RATE',
    'Estimated  Basic cost', 'Total Cost (Incl OBS, SME & STE, Docs, Training, etc) without escalation (in INR)',
    'Mid point of delivery when vessels are more than one', 'Escalation Period', 'Escalation Rate',
    'Total Cost (Incl OBS, SME & STE, Docs, Training, etc) with escalation (in INR)', 'Total Cost with escalation (in Crs)',
  ];
  const itemRows = (est?.items || []).map(it => ({
    'S.No': it.slNo,
    'Equipment': it.equipment,
    'Qty': it.qty,
    'Unit cost': it.currency === 'INR' ? fmt(it.unitCost) : `${it.currency} ${Math.round(it.unitCost || 0).toLocaleString('en-IN')}`,
    'Is it from LPP/BQ': it.costSource,
    'Reference of cost (LPP / BQ)': it.reference,
    'LPP Delivery date / BQ Validity or Delivery Date': it.costDate,
    'Indg/Import': it.origin,
    'Currency': it.currency,
    'RATE': it.exchangeRate,
    'Estimated  Basic cost': fmt(it.basicCost),
    'Total Cost (Incl OBS, SME & STE, Docs, Training, etc) without escalation (in INR)': fmt(it.totalNoEsc),
    'Mid point of delivery when vessels are more than one': it.midDelivery,
    'Escalation Period': `${it.escalationPeriod} yr`,
    'Escalation Rate': `${it.escalationRate}%`,
    'Total Cost (Incl OBS, SME & STE, Docs, Training, etc) with escalation (in INR)': fmt(it.totalWithEsc),
    'Total Cost with escalation (in Crs)': (it.totalCrs ?? 0).toFixed(4),
  }));

  const downloadEnq = async (e, kind) => {
    const payload = { title: `BQ Enquiry — ${e.vendor}`, subtitle: e.reference, text: e.email, filename: `BQ_${e.vendor.replace(/[^a-z0-9]+/gi, '_')}` };
    try { kind === 'pdf' ? await downloadPdf(payload) : await downloadWord(payload); } catch (_) {}
  };

  return (
    <Page
      title="Ship Cost Estimation Assistant"
      subtitle="Generate a preliminary ship cost estimate from the AI-generated BOM using representative unit rates, identify approved vendors from a sample vendor database, auto-prepare vendor-wise Budgetary Quotation (BQ) enquiry emails for review & dispatch, and refine the estimate as BQs are received — with full traceability."
    >
      <Card title="1 · Source & Estimate" desc="Select the RFP / Build Specification. The assistant builds the BOM, prices it, and prepares vendor enquiries.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Source documents (RFP / Build Spec)" values={sources} onChange={(v) => { setSources(v); setEst(null); setEnq(null); }} />
          <Field label="Project" value={project} onChange={setProject} placeholder="e.g. Tug 2400 / Yard 11190" />
        </div>
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Estimation parameters (drive the cost template)</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Field label="Overheads % (OBS/SME/Docs)" value={overheadPct} onChange={setOverheadPct} placeholder="20" />
            <Field label="Escalation rate % / yr" value={escalationRate} onChange={setEscalationRate} placeholder="5" />
            <Field label="Escalation period (yr)" value={escalationPeriod} onChange={setEscalationPeriod} placeholder="1.5" />
            <Field label="USD rate (₹/USD)" value={usdRate} onChange={setUsdRate} placeholder="84" />
            <Field label="Delivery schedule (months)" value={deliveryMonths} onChange={setDeliveryMonths} placeholder="18" />
          </div>
        </div>
        <RunButton onClick={run} busy={busy} busyLabel={stage || 'Working…'}>Generate BOM &amp; Estimate Cost</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && stage && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> {stage}</div>}
      </Card>

      {est && (
        <>
          <Card title="2 · Preliminary Ship Cost Estimate" desc={est.note}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Total (preliminary)" value={est.totalFmt} tone="emerald" />
              <StatTile label="Line Items" value={est.items.length} tone="sky" />
              <StatTile label="Disciplines" value={est.byDiscipline.length} tone="violet" />
              <StatTile label="BQ Applied" value={est.bqApplied || 0} tone="amber" />
            </div>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Discipline-wise Cost</div>
                <div className="rounded-lg border border-app-border divide-y divide-white/[0.05]">
                  {est.byDiscipline.map(d => (
                    <div key={d.name} className="flex items-center justify-between px-3 py-1.5 text-[11px]"><span className="text-slate-300">{d.name}</span><span className="font-mono text-slate-200">{d.amountFmt}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">System-wise Cost</div>
                <div className="rounded-lg border border-app-border divide-y divide-white/[0.05] max-h-52 overflow-y-auto">
                  {est.bySystem.map(s => (
                    <div key={s.name} className="flex items-center justify-between px-3 py-1.5 text-[11px]"><span className="text-slate-300 truncate pr-2">{s.name}</span><span className="font-mono text-slate-200 shrink-0">{s.amountFmt}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card title="3 · Ship Cost Estimate (HSL format)" desc="Costs are in the prescribed HSL format — LPP/BQ source, Indigenous/Import, currency & exchange RATE, estimated basic cost, total incl. OBS/SME &amp; STE/Docs/Training, and escalation to the mid-point of delivery (INR and Crores).">
            <ResultTable
              columns={COST_COLS}
              rows={itemRows} title={`Ship Cost Estimate${project ? ' · ' + project : ''}`} sheetName="Cost Estimate" downloadName={`Ship_Cost_${(project || 'estimate').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
            <FeedbackBar module="cost" subject={`Cost estimate ${project}`} />
          </Card>

          <Card title="4 · Refine with Budgetary Quotations" desc="Enter a received BQ unit rate for an item (matched by name) to override the representative rate and auto-update the estimate.">
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <Field label="Item (name contains)" value={bqItem} onChange={setBqItem} placeholder="e.g. Generator" />
              <Field label="Vendor" value={bqVendor} onChange={setBqVendor} placeholder="e.g. Cummins India" />
              <Field label="BQ unit rate (₹)" value={bqRate} onChange={setBqRate} placeholder="e.g. 4200000" />
              <button onClick={addBq} className="px-3 py-2 rounded-lg bg-slate-700/50 text-slate-200 border border-slate-600 text-[11px] font-semibold hover:bg-slate-700">Add BQ</button>
            </div>
            {bqs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {bqs.map((b, i) => <span key={i} className="text-[10px] px-2 py-1 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30">{b.item} = {fmt(b.rate)}{b.vendor ? ` · ${b.vendor}` : ''}</span>)}
              </div>
            )}
            <RunButton onClick={applyBqs} busy={busy} disabled={!bqs.length} busyLabel="Updating estimate…">Apply BQs &amp; Update Estimate</RunButton>
          </Card>
        </>
      )}

      {enq && (
        <Card title="5 · Vendor-wise BQ Enquiries" desc="Auto-prepared enquiry emails for Administrator review & dispatch through HSL's external email system. Download as Word or PDF.">
          <div className="space-y-2">
            {enq.enquiries.map((e, i) => (
              <div key={i} className="rounded-lg border border-app-border bg-slate-950/30">
                <button onClick={() => setOpenEnq(openEnq === i ? null : i)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.02]">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-violet-500/15 text-violet-300 border-violet-500/30 uppercase">{e.category}</span>
                  <span className="flex-1 min-w-0"><span className="block text-[12px] text-slate-200 font-semibold truncate">{e.vendor}</span><span className="block text-[10px] text-slate-500">{e.reference} · {e.itemCount} item(s) · {e.status}</span></span>
                  <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${openEnq === i ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {openEnq === i && (
                  <div className="px-3 pb-3 space-y-2 border-t border-app-border">
                    <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-sans bg-slate-900/50 rounded-lg p-3 mt-2 max-h-72 overflow-y-auto">{e.email}</pre>
                    <div className="flex gap-2">
                      <button onClick={() => downloadEnq(e, 'word')} className="text-[10px] px-2.5 py-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25">Download Word</button>
                      <button onClick={() => downloadEnq(e, 'pdf')} className="text-[10px] px-2.5 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25">Download PDF</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <ModuleChat module="cost" title="Ask about ship cost estimation"
        placeholder="e.g. How are the representative unit rates derived?"
        suggestions={['What is included in a preliminary ship cost estimate?', 'How does the BQ update change the total?', 'How are approved vendors matched to BOM items?']} />
    </Page>
  );
}
