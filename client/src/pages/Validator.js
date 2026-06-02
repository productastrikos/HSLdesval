import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BUILD_SPECS, RULE_CORPUS, SPEC_RULE_MAP } from '../services/hslKnowledge';
import { validate, isConfigured } from '../services/aiService';

// ── Static demo findings (used when AI is not configured) ─────────────────────
function staticFindingsFor(spec) {
  const domain = spec?.domain || 'Hull';
  const byDomain = {
    Hull: [
      { ruleId:'IRS-P3-C6-S4', section:'§4.2 Bulkhead Spacing',       finding:'Bulkhead at Fr84 exceeds 30-frame max spacing per IRS Pt.3 Ch.6 Sec.4',       severity:'critical', status:'open',      impact:-8 },
      { ruleId:'IRS-P3-C6-S2', section:'§5.1 Plate Thickness Fr112', finding:'12.5 mm specified; IRS 2024 amendment requires 13.0 mm below waterline',      severity:'high',     status:'open',      impact:-5 },
      { ruleId:'IACS-UR-S6',   section:'§7.2 Material Grade S2',     finding:'Grade A used in strength-deck stringer plate amidships; IACS UR S6 requires D or E', severity:'medium', status:'in-review', impact:-3 },
    ],
    Electrical: [
      { ruleId:'IEC-60092-352', section:'§11.1 Cable Tray Segregation', finding:'Power/instrumentation cables in tray T-E-204 have 80 mm gap; 100 mm required by IEC 60092-352', severity:'high', status:'open', impact:-4 },
    ],
    HVAC: [
      { ruleId:'DNV-P4-C7-S2', section:'§3.4 HVAC Redundancy', finding:'Supply fan SF-1 has no N+1 backup; DNV Pt.4 Ch.7 Sec.2 requires redundancy for machinery spaces', severity:'medium', status:'in-review', impact:-3 },
    ],
    Piping: [
      { ruleId:'IMO-MARPOL-A1-R14', section:'§2.3 Bilge OWS Interlock', finding:'Oil-content-meter interlock not wired to bilge pump stop; mandatory per MARPOL Annex I Reg.14', severity:'high', status:'open', impact:-4 },
    ],
    Mechanical: [
      { ruleId:'ABS-P4-C2', section:'§6.1 Propulsion Shaft Schedule', finding:'Intermediate shaft diameter under-sized by 3 mm vs ABS Pt.4 Ch.2 formula', severity:'medium', status:'resolved', impact:0 },
    ],
    Outfit: [
      { ruleId:'IRS-NAVAL-V2', section:'§9.7 Combat System Mounts', finding:'Shock isolator type unspecified for Grade A mounts; NSQR Vol-II requires vendor certification', severity:'critical', status:'open', impact:-7 },
    ],
  };
  return byDomain[domain] || [];
}

const SEV_STYLE = {
  critical: { txt:'text-red-400',    bg:'bg-red-500/15',    border:'border-red-500/30',    dot:'bg-red-500' },
  high:     { txt:'text-orange-400', bg:'bg-orange-500/15', border:'border-orange-500/30', dot:'bg-orange-500' },
  medium:   { txt:'text-amber-400',  bg:'bg-amber-500/15',  border:'border-amber-500/30',  dot:'bg-amber-500' },
  low:      { txt:'text-sky-400',    bg:'bg-sky-500/15',    border:'border-sky-500/30',    dot:'bg-sky-500' },
};
const STATUS_STYLE = {
  open:         { txt:'text-red-300',     bg:'bg-red-500/15',     label:'Open'      },
  'in-review':  { txt:'text-amber-300',   bg:'bg-amber-500/15',   label:'In Review' },
  resolved:     { txt:'text-emerald-300', bg:'bg-emerald-500/15', label:'Resolved'  },
};

export default function Validator() {
  const navigate = useNavigate();
  const [selectedSpec, setSelectedSpec] = useState(BUILD_SPECS[0].id);
  const [filter,       setFilter]       = useState('all');
  const [running,      setRunning]      = useState(false);
  const [scanLog,      setScanLog]      = useState([]);
  const [aiFindings,   setAiFindings]   = useState(null);
  const [aiError,      setAiError]      = useState(null);

  const spec     = BUILD_SPECS.find(s => s.id === selectedSpec);
  const ruleIds  = SPEC_RULE_MAP[selectedSpec] || [];
  const rules    = RULE_CORPUS.filter(r => ruleIds.includes(r.id));
  const aiMode   = isConfigured();

  // Use AI findings if available, else static
  const findings = useMemo(() => {
    if (aiFindings !== null) return aiFindings;
    return staticFindingsFor(spec);
  }, [aiFindings, spec]);

  const visible = useMemo(() => {
    if (filter === 'all') return findings;
    return findings.filter(f => f.severity === filter || f.status === filter);
  }, [findings, filter]);

  const counts = useMemo(() => ({
    critical: findings.filter(f => f.severity === 'critical').length,
    high:     findings.filter(f => f.severity === 'high').length,
    medium:   findings.filter(f => f.severity === 'medium').length,
    open:     findings.filter(f => f.status === 'open').length,
    resolved: findings.filter(f => f.status === 'resolved').length,
  }), [findings]);

  const score = useMemo(() => {
    return Math.max(40, 100 + findings.reduce((s, f) => s + (f.status === 'resolved' ? 0 : (f.impact || 0)), 0));
  }, [findings]);

  const runScan = async () => {
    setRunning(true);
    setScanLog([]);
    setAiFindings(null);
    setAiError(null);

    const steps = aiMode ? [
      `Loading Build Spec ${selectedSpec}…`,
      `Domain: ${spec?.domain} — retrieving applicable rules from KB…`,
      `Running TF-IDF retrieval across ${spec?.pages || 200} pages…`,
      `Cross-referencing IRS / DNV / ABS / IACS clauses…`,
      `Checking IMO MARPOL & SOLAS applicability…`,
      `Verifying IEC 60092 series electrical clauses…`,
      `Sending to Claude for compliance analysis…`,
      `Detecting inconsistencies and repetitive statements…`,
      `Computing compliance score…`,
      `Scan complete · AI findings ready`,
    ] : [
      `Loading Build Spec ${selectedSpec}…`,
      `Tokenising ${spec?.pages || 200} pages…`,
      `Retrieving applicable rule corpus (${rules.length} rules)…`,
      `Cross-referencing IRS / DNV / ABS / IACS clauses…`,
      `Checking IMO MARPOL & SOLAS applicability…`,
      `Verifying IEC 60092 series electrical clauses…`,
      `Detecting inconsistencies and repetitive statements…`,
      `Computing compliance score…`,
      `Scan complete · findings ready`,
    ];

    // Animate scan log
    steps.forEach((s, i) => {
      setTimeout(() => setScanLog(prev => [...prev, s]), i * 320);
    });

    if (aiMode) {
      // Start AI call in parallel with animation
      try {
        const result = await validate(selectedSpec, spec?.domain, `Build Spec: ${spec?.title}`);
        if (result.findings && result.findings.length > 0) {
          setAiFindings(result.findings);
        } else {
          setAiError('AI returned no structured findings. Showing raw analysis in log.');
          if (result.rawAnalysis) {
            setScanLog(prev => [...prev, '─── AI Analysis ───', ...result.rawAnalysis.split('\n').slice(0, 8)]);
          }
        }
      } catch (e) {
        setAiError(e.message);
        setScanLog(prev => [...prev, `⚠ AI error: ${e.message}`]);
      }
    }

    setTimeout(() => setRunning(false), steps.length * 320);
  };

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Rule Validator</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {aiMode
            ? 'AI-powered compliance scan — Claude cross-references build specs against the knowledge base'
            : 'Automated cross-referencing of Build Specifications against Class · IMO · IEC · Naval rules (demo mode)'
          }
        </p>
      </div>

      {/* Demo/AI banner */}
      {!aiMode && (
        <div className="flex items-center gap-2 bg-amber-500/[0.08] border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Demo mode — findings are static examples.
          <button onClick={() => navigate('/settings')} className="font-bold underline hover:text-white">Configure API key →</button>
        </div>
      )}
      {aiError && (
        <div className="flex items-center gap-2 bg-red-500/[0.08] border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          AI validation error: {aiError}
        </div>
      )}

      {/* Spec selector + score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-app-panel border border-app-border rounded-xl p-4 lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <select
              value={selectedSpec}
              onChange={e => { setSelectedSpec(e.target.value); setAiFindings(null); setScanLog([]); setAiError(null); }}
              className="flex-1 text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono font-bold"
            >
              {BUILD_SPECS.map(s => <option key={s.id} value={s.id}>{s.id} Rev.{s.rev} — {s.title}</option>)}
            </select>
            <button
              onClick={runScan}
              disabled={running}
              className="px-3 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 text-white text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-1.5"
            >
              {running ? (
                <><svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Scanning…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  {aiMode ? 'Run AI Validation Scan' : 'Run Validation Scan'}
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              { label:'Domain',      value:spec?.domain },
              { label:'Pages',       value:spec?.pages },
              { label:'Last Update', value:spec?.lastUpdated },
              { label:'Findings',    value:findings.length, className:'text-amber-400' },
            ].map(({ label, value, className }) => (
              <div key={label} className="bg-slate-950/40 rounded-lg p-2 border border-slate-800">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
                <div className={`text-sm font-bold mt-1 ${className || 'text-white'}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Scan log */}
          {scanLog.length > 0 && (
            <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[10px] max-h-36 overflow-y-auto">
              {scanLog.map((l, i) => (
                <div key={i} className={l.startsWith('⚠') ? 'text-red-400' : l.startsWith('─') ? 'text-slate-500' : 'text-slate-400'}>▸ {l}</div>
              ))}
              {running && <div className="text-sky-400 animate-pulse">▸ {aiMode ? 'Claude analyzing…' : 'Processing…'}</div>}
            </div>
          )}
        </div>

        {/* Compliance score */}
        <div className="bg-app-panel border border-app-border rounded-xl p-4 flex flex-col items-center justify-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Compliance Score</div>
          <div className="relative w-32 h-32">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" stroke="#1e293b" strokeWidth="10" fill="none" />
              <circle cx="50" cy="50" r="42"
                stroke={score >= 90 ? '#10b981' : score >= 75 ? '#f59e0b' : '#ef4444'}
                strokeWidth="10" fill="none"
                strokeDasharray={`${(score / 100) * 264} 264`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-white">{score}</span>
              <span className="text-[10px] text-slate-500">/ 100</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 w-full text-center text-[10px]">
            <div><div className="font-bold text-red-400">{counts.critical}</div><div className="text-slate-500 uppercase">Critical</div></div>
            <div><div className="font-bold text-orange-400">{counts.high}</div><div className="text-slate-500 uppercase">High</div></div>
            <div><div className="font-bold text-emerald-400">{counts.resolved}</div><div className="text-slate-500 uppercase">Resolved</div></div>
          </div>
          {aiFindings !== null && (
            <div className="mt-2 text-[9px] text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              AI findings
            </div>
          )}
        </div>
      </div>

      {/* Findings & Cross-references */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-app-border flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold text-white">Findings</h3>
            <div className="flex items-center gap-1 flex-wrap">
              {['all', 'critical', 'high', 'medium', 'open', 'resolved'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[10px] px-2 py-1 rounded border font-semibold uppercase tracking-widest ${
                    filter === f
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >{f}</button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {visible.length === 0 ? (
              <div className="text-center text-slate-500 text-[11px] py-8">No findings match the current filter.</div>
            ) : visible.map((f, i) => {
              const sev = SEV_STYLE[f.severity] || SEV_STYLE.low;
              const st  = STATUS_STYLE[f.status] || STATUS_STYLE.open;
              return (
                <div key={i} className="p-3 hover:bg-white/[0.02]">
                  <div className="flex items-start gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sev.dot} mt-1.5 shrink-0`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[9px] font-bold uppercase ${sev.txt} ${sev.bg} ${sev.border} border px-1.5 py-0.5 rounded`}>{f.severity}</span>
                        <span className={`text-[9px] font-bold uppercase ${st.txt} ${st.bg} px-1.5 py-0.5 rounded`}>{st.label}</span>
                        <span className="text-[10px] font-mono text-slate-500">{f.ruleId}</span>
                      </div>
                      <div className="text-[11px] font-semibold text-slate-200 leading-tight">{f.section}</div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{f.finding}</p>
                    </div>
                    {f.impact < 0 && (
                      <span className="text-[10px] font-bold text-red-400 shrink-0">{f.impact}%</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-app-border">
              <h3 className="text-sm font-bold text-white">Applicable Rules</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">{rules.length} rule clauses cross-referenced for {spec?.domain}</p>
            </div>
            <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto">
              {rules.map(r => (
                <div key={r.id} className="p-2 rounded bg-slate-950/40 border border-app-border">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[9px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded uppercase tracking-widest">{r.society}</span>
                    <span className="text-[10px] font-mono text-slate-500">{r.id}</span>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-200">{r.title}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
