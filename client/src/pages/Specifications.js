import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DOMAINS, RULE_CORPUS, DOMAIN_RULES, generateResponse } from '../services/hslKnowledge';
import { generateSpec, isConfigured } from '../services/aiService';

const TEMPLATES = [
  { id:'TPL-001', name:'Structural Steel Specification',  domain:'Hull',       sections:8 },
  { id:'TPL-002', name:'Main Switchboard Specification',  domain:'Electrical', sections:7 },
  { id:'TPL-003', name:'Bilge & Ballast Piping Spec',     domain:'Piping',     sections:9 },
  { id:'TPL-004', name:'Engine Room HVAC Spec',           domain:'HVAC',       sections:8 },
  { id:'TPL-005', name:'Main Propulsion Shafting Spec',   domain:'Mechanical', sections:9 },
  { id:'TPL-006', name:'Naval Combat System Mounts',      domain:'Outfit',     sections:7 },
];

export default function Specifications() {
  const navigate = useNavigate();
  const [domain,       setDomain]       = useState('Hull');
  const [template,     setTemplate]     = useState(TEMPLATES[0].id);
  const [vesselName,   setVesselName]   = useState('HSL-2026-001 (Frigate Class A)');
  const [lbp,          setLbp]          = useState(105);
  const [classSociety, setClassSociety] = useState('IRS');
  const [includeNaval, setIncludeNaval] = useState(true);
  const [generated,    setGenerated]    = useState(null);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState(null);

  const aiMode = isConfigured();

  const templates = useMemo(() => TEMPLATES.filter(t => t.domain === domain), [domain]);

  const applicableRules = useMemo(() => {
    const ids = DOMAIN_RULES[domain] || [];
    return RULE_CORPUS.filter(r => ids.includes(r.id) || r.society === classSociety || (includeNaval && r.society.includes('Naval')));
  }, [domain, classSociety, includeNaval]);

  const generate = async () => {
    setBusy(true);
    setGenerated(null);
    setError(null);

    if (aiMode) {
      try {
        const result = await generateSpec({ domain, vessel: vesselName, lbp, classSociety, includeNaval });
        setGenerated({ spec: result.spec, citations: result.citations || [], rules: applicableRules });
      } catch (e) {
        setError(e.message);
        setBusy(false);
        return;
      }
    } else {
      // Demo fallback
      await new Promise(r => setTimeout(r, 900));
      const resp = generateResponse(`generate ${domain} specification`);
      const spec = {
        ...resp.spec,
        title: `${domain} System — ${vesselName} — Technical Specification`,
        meta: {
          vessel: vesselName,
          lbp: `${lbp} m`,
          classSociety,
          generatedAt: new Date().toLocaleString('en-IN'),
        },
      };
      setGenerated({ spec, citations: [], rules: applicableRules });
    }

    setBusy(false);
  };

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Specification Generator</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {aiMode
            ? 'AI-powered specification generation — Claude drafts rule-compliant specs from the knowledge base'
            : 'Auto-generate rule-compliant technical specifications aligned to Class · IMO · IEC · Naval standards (demo mode)'
          }
        </p>
      </div>

      {/* Demo/error banners */}
      {!aiMode && (
        <div className="flex items-center gap-2 bg-amber-500/[0.08] border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Demo mode — showing template spec.
          <button onClick={() => navigate('/settings')} className="font-bold underline hover:text-white">Configure API key →</button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/[0.08] border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Configurator */}
        <div className="bg-app-panel border border-app-border rounded-xl p-4 lg:col-span-1 space-y-3">
          <h3 className="text-sm font-bold text-white">Configure</h3>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Engineering Domain</label>
            <select
              value={domain}
              onChange={e => { setDomain(e.target.value); setTemplate(TEMPLATES.find(t => t.domain === e.target.value)?.id || TEMPLATES[0].id); }}
              className="w-full text-[12px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
            >
              {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Template</label>
            <select
              value={template}
              onChange={e => setTemplate(e.target.value)}
              className="w-full text-[12px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
            >
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Vessel / Project</label>
            <input
              value={vesselName}
              onChange={e => setVesselName(e.target.value)}
              className="w-full text-[12px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1">LBP (m)</label>
              <input
                type="number"
                value={lbp}
                onChange={e => setLbp(Number(e.target.value))}
                className="w-full text-[12px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Class Society</label>
              <select
                value={classSociety}
                onChange={e => setClassSociety(e.target.value)}
                className="w-full text-[12px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
              >
                {['IRS','DNV','ABS','IACS'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeNaval}
              onChange={e => setIncludeNaval(e.target.checked)}
              className="accent-sky-500"
            />
            Include Naval / NSQR clauses
          </label>

          <button
            onClick={generate}
            disabled={busy}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 text-white text-xs font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {busy
              ? (aiMode ? 'Claude generating…' : 'Generating…')
              : (aiMode ? '✦ Generate with AI' : 'Generate Specification')
            }
          </button>

          <div className="pt-2 border-t border-app-border">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Will reference</div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {applicableRules.map(r => (
                <div key={r.id} className="text-[10px] font-mono text-slate-400 bg-slate-950/40 px-2 py-1 rounded border border-slate-800">
                  <span className="text-sky-400 font-bold">{r.society}</span> · {r.id}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Generated spec */}
        <div className="lg:col-span-2">
          {!generated && !busy && (
            <div className="bg-app-panel border border-app-border border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center text-slate-500">
              <svg className="w-14 h-14 text-slate-700 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.3} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2zM9 13h6M9 17h6M9 9h1" />
              </svg>
              <div className="text-sm font-bold text-slate-400">No specification generated yet</div>
              <div className="text-[11px] text-slate-600 mt-1">
                Configure parameters and click <span className="text-sky-400 font-semibold">{aiMode ? '✦ Generate with AI' : 'Generate'}</span>.
              </div>
            </div>
          )}

          {busy && (
            <div className="bg-app-panel border border-app-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
              <svg className="w-10 h-10 animate-spin text-sky-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div className="text-sm font-bold text-slate-400">{aiMode ? 'Claude is drafting the specification…' : 'Composing specification'}</div>
              <div className="text-[11px] text-slate-600 mt-1">
                {aiMode
                  ? 'Retrieving rules from KB, grounding spec in class requirements…'
                  : 'Aggregating clauses, formatting and applying corporate template…'
                }
              </div>
            </div>
          )}

          {generated && (
            <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-app-border flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                      {generated.spec.meta?.generatedAt || new Date().toLocaleString('en-IN')}
                    </div>
                    {aiMode && (
                      <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded uppercase">AI Generated</span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-white truncate">{generated.spec.title}</div>
                </div>
                <span className="text-[10px] px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold uppercase">{generated.spec.revision}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 bg-white/[0.02] text-[10px]">
                <div><div className="text-slate-500 uppercase">Vessel</div><div className="text-slate-200 font-semibold">{generated.spec.meta?.vessel}</div></div>
                <div><div className="text-slate-500 uppercase">LBP</div><div className="text-slate-200 font-semibold">{generated.spec.meta?.lbp}</div></div>
                <div><div className="text-slate-500 uppercase">Class</div><div className="text-slate-200 font-semibold">{generated.spec.meta?.classSociety}</div></div>
                <div><div className="text-slate-500 uppercase">Domain</div><div className="text-slate-200 font-semibold">{domain}</div></div>
              </div>

              <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto">
                {(generated.spec.sections || []).map((s, i) => (
                  <div key={i} className="border-l-2 border-sky-500/40 pl-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400">{i + 1}. {s.heading}</div>
                    <p className="text-[12px] text-slate-200 leading-relaxed mt-1">{s.body}</p>
                  </div>
                ))}

                {/* AI citations */}
                {generated.citations && generated.citations.length > 0 && (
                  <div className="pt-2 border-t border-app-border">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1.5">References</div>
                    <div className="flex flex-wrap gap-1">
                      {generated.citations.map((c, i) => (
                        <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-app-border bg-white/[0.02] flex items-center gap-2 flex-wrap">
                {['.docx', '.pdf', '.xlsx', '.odf'].map(f => (
                  <button key={f} className="text-[11px] px-3 py-1.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold hover:bg-sky-500/25 transition-colors">Export {f}</button>
                ))}
                <span className="ml-auto text-[10px] text-slate-500 italic">Draft — pending Lead Engineer sign-off</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saved specifications (static list for reference) */}
      <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border">
          <h3 className="text-sm font-bold text-white">Recently Generated</h3>
        </div>
        <table className="w-full text-[11px]">
          <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.02]">
            <tr>
              <th className="text-left px-3 py-2 font-bold">Spec ID</th>
              <th className="text-left px-3 py-2 font-bold">Title</th>
              <th className="text-left px-3 py-2 font-bold">Domain</th>
              <th className="text-right px-3 py-2 font-bold">Generated</th>
              <th className="text-center px-3 py-2 font-bold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {[
              { id:'GEN-2025-031', t:'HVAC System — HSL-2026-001 — Engine Room',         d:'HVAC',       at:'2025-11-14 14:22', st:'approved' },
              { id:'GEN-2025-030', t:'Bilge & Ballast System — HSL-2026-001',            d:'Piping',     at:'2025-11-13 11:04', st:'review' },
              { id:'GEN-2025-029', t:'Main Switchboard — HSL-2026-001',                  d:'Electrical', at:'2025-11-12 09:18', st:'approved' },
              { id:'GEN-2025-028', t:'Naval Combat Mounts (Grade A Shock) — HSL-2026-001', d:'Outfit',   at:'2025-11-11 16:55', st:'draft' },
              { id:'GEN-2025-027', t:'Propulsion Shafting — HSL-2026-001',               d:'Mechanical', at:'2025-11-10 14:30', st:'approved' },
            ].map(r => {
              const st = r.st === 'approved' ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                       : r.st === 'review'   ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                       :                       'text-slate-300 bg-slate-700/40 border-slate-600';
              return (
                <tr key={r.id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-mono text-slate-500">{r.id}</td>
                  <td className="px-3 py-2 text-slate-200 font-semibold">{r.t}</td>
                  <td className="px-3 py-2 text-slate-400">{r.d}</td>
                  <td className="text-right px-3 py-2 text-slate-400 font-mono">{r.at}</td>
                  <td className="text-center px-3 py-2"><span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${st}`}>{r.st}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
