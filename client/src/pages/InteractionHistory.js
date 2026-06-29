import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, Field, Spinner } from '../components/feature/FeatureKit';
import { getInteractions, deleteInteraction } from '../services/featureApi';

function fmtTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('en-GB', { hour12: false }); } catch (_) { return ts; }
}

export default function InteractionHistory() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ module: '', q: '', from: '', to: '' });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const set = (k) => (v) => setFilters(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await getInteractions({ ...filters, limit: 800 });
      setItems(res.interactions || []);
      setTotal(res.total || 0);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }, [filters]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onContinue = (it) => {
    try { sessionStorage.setItem('continuePrompt', it.prompt || ''); } catch (_) {}
    navigate('/chatbot');
  };
  const onCopy = (text) => { try { navigator.clipboard.writeText(text || ''); } catch (_) {} };
  const onDelete = async (id) => {
    try { await deleteInteraction(id); setItems(items.filter(i => i.id !== id)); setTotal(t => Math.max(0, t - 1)); }
    catch (e) { setError(e.message); }
  };

  const modules = [...new Set(items.map(i => i.module))];
  const exportRows = items.map(i => ({
    'Date & Time': fmtTs(i.ts), 'Module': i.module, 'Prompt / Query': i.prompt,
    'AI Response (excerpt)': i.response, 'Context': i.subject || '',
  }));

  return (
    <Page
      title="User Interaction History"
      subtitle="Your searches, prompts and AI-generated responses across every module — searchable and filterable. Revisit a previous interaction, reuse its prompt, or continue it in the Rules & Regulations Assistant. Export the full history to Excel, Word or PDF."
    >
      <Card title="Filters" desc="Find past interactions by module, keyword or date range.">
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Module" value={filters.module} onChange={set('module')} placeholder="e.g. BOM, Drawing" />
          <Field label="From (YYYY-MM-DD)" value={filters.from} onChange={set('from')} placeholder="2026-06-01" />
          <Field label="To (YYYY-MM-DD)" value={filters.to} onChange={set('to')} placeholder="2026-06-30" />
          <Field label="Keyword" value={filters.q} onChange={set('q')} placeholder="search prompt or response…" />
        </div>
        <RunButton onClick={load} busy={busy} busyLabel="Loading history…">Apply filters / Refresh</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label="Interactions" value={total} tone="sky" />
        <StatTile label="Showing" value={items.length} tone="violet" />
        <StatTile label="Modules used" value={modules.length} tone="emerald" />
      </div>

      <Card title="History" desc="Click an entry to revisit the full prompt and response.">
        {busy && !items.length ? (
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Spinner /> Loading…</div>
        ) : items.length ? (
          <div className="space-y-2">
            {items.map(it => (
              <div key={it.id} className="rounded-lg border border-app-border bg-slate-950/30">
                <button onClick={() => setOpenId(openId === it.id ? null : it.id)}
                  className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-white/[0.02]">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-300 border-sky-500/30 uppercase whitespace-nowrap mt-0.5">{it.module}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12px] text-slate-200 truncate">{it.prompt || '(no prompt)'}</span>
                    <span className="block text-[10px] text-slate-500">{fmtTs(it.ts)}{it.subject ? ` · ${it.subject}` : ''}</span>
                  </span>
                  <svg className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${openId === it.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {openId === it.id && (
                  <div className="px-3 pb-3 space-y-2 border-t border-app-border">
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mt-2 mb-1">Prompt / Query</div>
                      <div className="text-[12px] text-slate-200 whitespace-pre-wrap bg-slate-900/50 rounded-lg p-2">{it.prompt}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mb-1">AI Response (excerpt)</div>
                      <div className="text-[12px] text-slate-300 whitespace-pre-wrap bg-slate-900/50 rounded-lg p-2 max-h-72 overflow-y-auto">{it.response}{it.response?.length >= 600 ? ' …' : ''}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => onContinue(it)} className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-semibold hover:bg-sky-500/25">Continue in Assistant →</button>
                      <button onClick={() => onCopy(it.prompt)} className="px-2.5 py-1 rounded-lg bg-slate-700/40 text-slate-300 border border-slate-600 text-[10px] font-semibold hover:bg-slate-700/70">Copy prompt</button>
                      <button onClick={() => onDelete(it.id)} className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30 text-[10px] font-semibold hover:bg-red-500/20">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="pt-2">
              <ResultTable columns={['Date & Time', 'Module', 'Prompt / Query', 'AI Response (excerpt)', 'Context']} rows={exportRows}
                title="User Interaction History" sheetName="Interactions" downloadName="Interaction_History" />
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">No interactions yet. Your prompts and AI responses across the modules will appear here automatically.</div>
        )}
      </Card>
    </Page>
  );
}
