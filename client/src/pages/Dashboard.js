import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, Field, Spinner, FeedbackBar } from '../components/feature/FeatureKit';
import { dashboardAnalytics } from '../services/featureApi';

function QuickTile({ to, icon, title, desc, accent }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(to)} className="bg-app-panel border border-app-border rounded-xl p-4 text-left hover:border-sky-500/50 transition-all group">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
        <span className="text-sm font-semibold text-white group-hover:text-sky-300 transition-colors">{title}</span>
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{desc}</p>
    </button>
  );
}

function Bar({ label, value, max, tone = 'sky' }) {
  const pct = max > 0 ? Math.round((Number(value) || 0) / max * 100) : 0;
  const color = { sky: 'bg-sky-500', amber: 'bg-amber-500', red: 'bg-red-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500' }[tone] || 'bg-sky-500';
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className="w-44 truncate text-slate-300" title={label}>{label}</div>
      <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <div className="w-10 text-right text-slate-400 font-mono">{value}</div>
    </div>
  );
}

const ICN = {
  chat: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  conv: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  draw: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 9h16M9 4v16',
  bom:  'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
};

export default function Dashboard() {
  const [prompt, setPrompt]   = useState('');
  const [sources, setSources] = useState([]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [res, setRes]         = useState(null);

  const run = async () => {
    if (!prompt.trim()) { setError('Enter what you want the dashboard to analyse.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      setRes(await dashboardAnalytics({ prompt, sources: sources.map(s => ({ name: s.name, text: s.text })) }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">HSL Intelligence Dashboard</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">Prompt-driven analytics — nothing is pre-populated. Ask a question and select documents to generate equipment-wise insights.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickTile to="/chatbot"   accent="bg-sky-500/15 text-sky-400"     title="Rules & Regulations Assistant"     desc="Ask anything across the entire HSL knowledge base."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.chat} /></svg>} />
        <QuickTile to="/converter" accent="bg-emerald-500/15 text-emerald-400" title="Document Converter" desc="Extract any data into custom columns → Excel / Word."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.conv} /></svg>} />
        <QuickTile to="/drawings"  accent="bg-amber-500/15 text-amber-400"  title="Drawing Intelligence" desc="SLD/GA extraction, BOM, compartments, IRS validation."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.draw} /></svg>} />
        <QuickTile to="/bom"       accent="bg-violet-500/15 text-violet-400" title="BOM & SOTR"          desc="Generate a BOM from RFP/specs, then derive the SOTR."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.bom} /></svg>} />
      </div>

      <Card title="Prompt-Driven Analytics" desc="Select documents and ask for an equipment-wise breakdown, counts, comparisons or KPIs — the dashboard is built strictly from your prompt and the selected documents.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Documents to analyse (optional)" values={sources} onChange={setSources} />
          <Field label="What should the dashboard show?" value={prompt} onChange={setPrompt} textarea rows={4}
            placeholder="e.g. Equipment-wise count of requirements in the SOTR · Compare compliance across the selected offers · Breakdown of observations by equipment" />
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Building dashboard…">Generate Analytics</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading the selected documents and computing analytics…</div>}
      </Card>

      {res && (
        <Card title="Analytics" desc={res.sources?.length ? `Based on: ${res.sources.join(', ')}` : 'Based on your prompt'}>
          {res.summary && <p className="text-[12px] text-slate-200 leading-relaxed">{res.summary}</p>}
          {res.kpis?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {res.kpis.map((k, i) => <StatTile key={i} label={`${k.label}${k.unit ? ` (${k.unit})` : ''}`} value={k.value} tone={k.tone || 'sky'} />)}
            </div>
          )}
          {(res.charts || []).map((c, ci) => {
            const max = Math.max(...(c.data || []).map(d => Number(d.value) || 0), 1);
            return (
              <div key={ci} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.title}</div>
                {(c.data || []).slice(0, 16).map((d, i) => <Bar key={i} label={d.label} value={d.value} max={max} tone={['sky', 'violet', 'amber', 'emerald'][ci % 4]} />)}
              </div>
            );
          })}
          {res.table?.columns?.length > 0 && (
            <ResultTable columns={res.table.columns} rows={res.table.rows || []} title="Analytics Detail" sheetName="Analytics" downloadName="Dashboard_Analytics" />
          )}
          {(!res.summary && !res.kpis?.length && !res.charts?.length && !res.table?.columns?.length) && (
            <div className="text-[11px] text-slate-500 py-4 text-center">No analytics could be derived. Try selecting documents or refining the prompt.</div>
          )}
          <FeedbackBar module="dashboard" subject={prompt.slice(0, 80)} />
        </Card>
      )}
    </div>
  );
}
