import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Page, Card, StatTile, ErrorNote, Field, Spinner } from '../components/feature/FeatureKit';
import { listUserDocs, getUserDoc, removeUserDoc, setDocMeta, addUserDoc } from '../services/docStore';
import { uploadDocument } from '../services/aiService';

const DISCIPLINES = ['', 'Electrical', 'Machinery', 'Hull', 'Outfit', 'Piping', 'HVAC', 'Production', 'QA', 'Planning', 'General'];

// Build Project → Discipline → docs hierarchy.
function buildTree(docs) {
  const tree = {};
  for (const d of docs) {
    const proj = d.project || 'Unassigned';
    const disc = d.discipline || 'General';
    tree[proj] = tree[proj] || {};
    tree[proj][disc] = tree[proj][disc] || [];
    tree[proj][disc].push(d);
  }
  return tree;
}

export default function Workspace() {
  const [docs, setDocs]   = useState([]);
  const [query, setQuery] = useState('');
  const [openProjects, setOpenProjects] = useState({});
  const [viewer, setViewer] = useState(null);   // { name, text }
  const [error, setError] = useState(null);

  // inline uploader
  const [project, setProject]       = useState('Unassigned');
  const [discipline, setDiscipline] = useState('');
  const [upStage, setUpStage]       = useState('idle');
  const fileRef = useRef(null);

  const refresh = useCallback(() => { listUserDocs().then(setDocs).catch(() => setDocs([])); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('docstore:changed', refresh);
    return () => window.removeEventListener('docstore:changed', refresh);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(d => `${d.name} ${d.type} ${d.project} ${d.discipline}`.toLowerCase().includes(q));
  }, [docs, query]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const projectNames = Object.keys(tree).sort();
  const allProjects = useMemo(() => [...new Set(docs.map(d => d.project || 'Unassigned'))].sort(), [docs]);

  const toggle = (p) => setOpenProjects(s => ({ ...s, [p]: !s[p] }));

  const onView = async (id) => {
    const d = await getUserDoc(id);
    if (d) setViewer({ name: d.name, text: d.text || '(no extractable text)' });
  };
  const onMove = async (id, field, value) => { await setDocMeta(id, { [field]: value }); };
  const onDelete = async (d) => {
    if (!window.confirm(`Remove "${d.name}" from the workspace?`)) return;
    try { await removeUserDoc(d.id); } catch (_) {}
  };

  const onUpload = async (file) => {
    if (!file) return;
    setUpStage('working'); setError(null);
    try {
      const result = await uploadDocument(file);
      await addUserDoc({
        id: result.docId, name: result.name, type: result.type, mime: result.mime || file.type,
        pages: result.pages, textLength: result.textLength, text: result.text, file,
        project: (project || 'Unassigned').trim() || 'Unassigned', discipline,
      });
      setUpStage('idle');
    } catch (e) { setError(e.message); setUpStage('idle'); }
  };

  return (
    <Page
      title="Workspace Management"
      subtitle="A hierarchical, project-wise repository for your documents — organised as Project → Discipline → Document. Upload into a project, browse, search and retrieve, and move documents between projects/disciplines. Documents here are available to every module."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Projects" value={allProjects.length} tone="sky" />
        <StatTile label="Documents" value={docs.length} tone="violet" />
        <StatTile label="Disciplines" value={new Set(docs.map(d => d.discipline || 'General')).size} tone="emerald" />
        <StatTile label="Pages" value={docs.reduce((s, d) => s + (d.pages || 0), 0)} tone="amber" />
      </div>

      <Card title="Add to a project" desc="Upload a document directly into a chosen project and discipline.">
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-[11px] font-semibold text-slate-300">Project / Workspace</label>
            <input list="ws-proj" value={project} onChange={e => setProject(e.target.value)} placeholder="e.g. Tug 2400"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200" />
            <datalist id="ws-proj">{allProjects.map(p => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-300">Discipline</label>
            <select value={discipline} onChange={e => setDiscipline(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
              {DISCIPLINES.map(d => <option key={d} value={d}>{d || '— none —'}</option>)}
            </select>
          </div>
          <div>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.gif,.docx,.txt,.csv,.dwg,.dxf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={upStage === 'working'}
              className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
              {upStage === 'working' ? <><Spinner /> Reading &amp; filing…</> : 'Upload into project'}
            </button>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <Card title="Repository" right={
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search documents…"
          className="text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 w-56" />
      }>
        {projectNames.length === 0 ? (
          <div className="text-[11px] text-slate-500">No documents yet. Upload one above — it will be filed under the chosen project and discipline.</div>
        ) : (
          <div className="space-y-2">
            {projectNames.map(proj => {
              const disciplines = tree[proj];
              const count = Object.values(disciplines).reduce((s, arr) => s + arr.length, 0);
              const open = openProjects[proj] ?? true;
              return (
                <div key={proj} className="rounded-lg border border-app-border bg-slate-950/30">
                  <button onClick={() => toggle(proj)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02]">
                    <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                    <span className="text-[12px] font-bold text-white">{proj}</span>
                    <span className="text-[10px] text-slate-500">· {count} document{count === 1 ? '' : 's'}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-2 space-y-2">
                      {Object.keys(disciplines).sort().map(disc => (
                        <div key={disc}>
                          <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold pl-5 py-1">{disc}</div>
                          <div className="space-y-1">
                            {disciplines[disc].map(d => (
                              <div key={d.id} className="flex items-center gap-2 pl-8 pr-2 py-1.5 rounded hover:bg-white/[0.02]">
                                <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-[11px] text-slate-200 truncate">{d.name}</span>
                                  <span className="block text-[9px] text-slate-500">{d.type} · {Math.round((d.textLength || 0) / 1000)}k chars · {d.pages || '—'} pages</span>
                                </span>
                                <select value={d.project} onChange={e => onMove(d.id, 'project', e.target.value)} title="Move to project"
                                  className="text-[10px] px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 max-w-[120px]">
                                  {[...new Set([...allProjects, 'Unassigned'])].map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <select value={d.discipline || ''} onChange={e => onMove(d.id, 'discipline', e.target.value)} title="Discipline"
                                  className="text-[10px] px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300">
                                  {DISCIPLINES.map(x => <option key={x} value={x}>{x || 'General'}</option>)}
                                </select>
                                <button onClick={() => onView(d.id)} title="View text" className="p-1 rounded text-slate-500 hover:text-sky-300 hover:bg-sky-500/10">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                </button>
                                <button onClick={() => onDelete(d)} title="Remove" className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {viewer && (
        <Card title={`Document · ${viewer.name}`} right={
          <button onClick={() => setViewer(null)} className="text-[11px] px-2 py-1 rounded bg-slate-700/40 text-slate-300 border border-slate-600 hover:bg-slate-700/70">Close</button>
        }>
          <div className="max-h-[55vh] overflow-y-auto rounded-lg bg-slate-950/40 border border-app-border p-4 text-[12px] text-slate-300 whitespace-pre-wrap leading-relaxed">
            {viewer.text}
          </div>
        </Card>
      )}
    </Page>
  );
}
