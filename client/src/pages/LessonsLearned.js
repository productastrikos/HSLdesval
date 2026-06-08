import React, { useEffect, useState, useCallback } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, Pill, Field, Spinner, ResultTable } from '../components/feature/FeatureKit';
import { listLessons, addLesson, deleteLesson, suggestLessons } from '../services/featureApi';

const CATEGORIES = ['Material', 'Design/Drawing', 'Workmanship', 'Installation', 'Documentation', 'Testing and Commissioning'];

export default function LessonsLearned() {
  const [tab, setTab] = useState('repo');

  return (
    <Page
      title="Lessons-Learned Repository"
      subtitle="A durable, cross-project knowledge base built from inspection findings. Search it, or let the assistant proactively surface relevant lessons, recurring issues and recommended design considerations for the system you are working on."
      actions={
        <div className="flex gap-1.5">
          <button onClick={() => setTab('repo')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${tab === 'repo' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Repository</button>
          <button onClick={() => setTab('assist')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${tab === 'assist' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Proactive Assistant</button>
        </div>
      }
    >
      {tab === 'repo' ? <Repository /> : <Assistant />}
    </Page>
  );
}

function Repository() {
  const [q, setQ]           = useState('');
  const [cat, setCat]       = useState('');
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState(null);
  const [showAdd, setAdd]   = useState(false);

  const load = useCallback(async () => {
    setLoad(true); setError(null);
    try { setData(await listLessons({ q, category: cat })); }
    catch (e) { setError(e.message); }
    setLoad(false);
  }, [q, cat]);

  // load() is a useCallback keyed on q/cat, so this debounced effect covers
  // the initial load and every filter change.
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const onDelete = async (id) => {
    try { await deleteLesson(id); load(); } catch (e) { setError(e.message); }
  };

  const tableRows = (data?.lessons || []).map((l, i) => ({
    'Sl.No': i + 1, 'Observation': l.observation, 'Category': l.category, 'System': l.system || '',
    'Project': l.project || '', 'Severity': l.severity || '', 'Recommendation': l.recommendation || '', 'Source': l.source || '',
  }));

  return (
    <>
      <Card>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <Field label="Search lessons" value={q} onChange={setQ} placeholder="keyword — system, defect, equipment…" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-300">Category</label>
            <select value={cat} onChange={e => setCat(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-slate-400">{loading ? <span className="flex items-center gap-1.5"><Spinner /> Loading…</span> : `${data?.count ?? 0} of ${data?.total ?? 0} lessons`}</div>
          <button onClick={() => setAdd(s => !s)} className="text-[11px] text-sky-300 hover:text-sky-200">{showAdd ? '− Cancel' : '+ Add lesson'}</button>
        </div>
        <ErrorNote>{error}</ErrorNote>
        {showAdd && <AddLessonForm onAdded={() => { setAdd(false); load(); }} />}
      </Card>

      {data?.lessons?.length > 0 && (
        <Card title="Lessons">
          <ResultTable columns={['Sl.No', 'Observation', 'Category', 'System', 'Project', 'Severity', 'Recommendation', 'Source']}
            rows={tableRows} title="Lessons-Learned" sheetName="Lessons" downloadName="Lessons_Learned" />
          <div className="space-y-2 mt-2">
            {data.lessons.slice(0, 60).map(l => (
              <div key={l.id} className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 text-[11px] flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill value={l.category}>{l.category}</Pill>
                    {l.severity && <Pill value={l.severity}>{l.severity}</Pill>}
                    {l.system && <span className="text-[10px] text-slate-500">{l.system}</span>}
                    {l.project && <span className="text-[10px] text-slate-600">· {l.project}</span>}
                  </div>
                  <div className="text-slate-200">{l.observation}</div>
                  {l.recommendation && <div className="text-slate-400">↳ {l.recommendation}</div>}
                </div>
                <button onClick={() => onDelete(l.id)} className="text-slate-600 hover:text-red-400" title="Delete">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {data && !data.lessons.length && !loading && (
        <Card><div className="text-[11px] text-slate-500 text-center py-6">No lessons yet. Analyse inspection reports or add lessons manually to build the repository.</div></Card>
      )}
    </>
  );
}

function AddLessonForm({ onAdded }) {
  const [f, setF] = useState({ observation: '', category: 'Design/Drawing', system: '', project: '', severity: 'medium', recommendation: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!f.observation.trim()) { setError('Observation is required.'); return; }
    setBusy(true); setError(null);
    try { await addLesson(f); onAdded(); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 space-y-3">
      <Field label="Observation" value={f.observation} onChange={set('observation')} textarea rows={2} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[11px] font-semibold text-slate-300">Category</label>
          <select value={f.category} onChange={e => set('category')(e.target.value)} className="w-full mt-1 px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Field label="System" value={f.system} onChange={set('system')} />
        <Field label="Project" value={f.project} onChange={set('project')} />
        <div>
          <label className="text-[11px] font-semibold text-slate-300">Severity</label>
          <select value={f.severity} onChange={e => set('severity')(e.target.value)} className="w-full mt-1 px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
            {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <Field label="Recommendation" value={f.recommendation} onChange={set('recommendation')} />
      <ErrorNote>{error}</ErrorNote>
      <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/40 text-[11px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save lesson'}</button>
    </div>
  );
}

function Assistant() {
  const [system, setSystem] = useState('');
  const [domain, setDomain] = useState('');
  const [query, setQuery]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  const [res, setRes]       = useState(null);

  const run = async () => {
    if (!system && !query) { setError('Enter a system or a query.'); return; }
    setBusy(true); setError(null); setRes(null);
    try { setRes(await suggestLessons({ system, domain, query })); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <>
      <Card title="Proactive Lessons Assistant" desc="Tell the tool what system you're designing — it surfaces relevant past lessons, recurring issues and recommended design considerations.">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="System" value={system} onChange={setSystem} placeholder="e.g. MB/SRE broadcast system" />
          <Field label="Domain (optional)" value={domain} onChange={setDomain} placeholder="Electrical / Hull / HVAC…" />
          <Field label="Specific query (optional)" value={query} onChange={setQuery} placeholder="e.g. cable segregation in machinery spaces" />
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Reviewing repository…">Get Lessons & Recommendations</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {res && (
        <Card title="Briefing" desc={res.summary}>
          <div className="grid md:grid-cols-3 gap-3">
            <StatTile label="Lessons Considered" value={res.lessonsConsidered} tone="sky" />
            <StatTile label="Relevant" value={res.relevantLessons?.length || 0} tone="emerald" />
            <StatTile label="Recurring Issues" value={res.recurringIssues?.length || 0} tone="amber" />
          </div>

          {res.relevantLessons?.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300">Relevant lessons</div>
              {res.relevantLessons.map((l, i) => (
                <div key={i} className="bg-slate-950/40 border border-slate-800 rounded-lg p-2.5 text-[11px]">
                  <div className="flex items-center gap-1.5 mb-0.5">{l.category && <Pill value={l.category}>{l.category}</Pill>}</div>
                  <div className="text-slate-200">{l.observation}</div>
                  {l.whyItMatters && <div className="text-slate-400 mt-0.5">Why it matters: {l.whyItMatters}</div>}
                </div>
              ))}
            </div>
          )}

          {res.recurringIssues?.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300">Recurring issues</div>
              {res.recurringIssues.map((r, i) => (
                <div key={i} className="text-[11px] text-slate-300 flex items-start gap-2">
                  <span className="text-amber-400">●</span><span>{r.issue} <span className="text-slate-500">({r.frequency}{r.category ? ` · ${r.category}` : ''})</span></span>
                </div>
              ))}
            </div>
          )}

          {res.designConsiderations?.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300">Recommended design considerations</div>
              {res.designConsiderations.map((d, i) => (
                <div key={i} className="bg-emerald-500/[0.05] border border-emerald-500/20 rounded-lg p-2.5 text-[11px]">
                  <div className="text-emerald-200">✓ {d.recommendation}</div>
                  {d.rationale && <div className="text-slate-400 mt-0.5">{d.rationale}</div>}
                  {d.reference && <div className="text-slate-500 text-[10px] mt-0.5">Ref: {d.reference}</div>}
                </div>
              ))}
            </div>
          )}
          {res.citations?.length > 0 && <div className="text-[10px] text-slate-500">Sources: {res.citations.join(' · ')}</div>}
        </Card>
      )}
    </>
  );
}
