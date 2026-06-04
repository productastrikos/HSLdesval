import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataContext } from '../services/socket';
import { CLASS_SOCIETIES, DOMAINS } from '../services/hslKnowledge';

// ── Quick-access tile ───────────────────────────────────────────────────────
function QuickTile({ to, icon, title, desc, accent }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="bg-app-panel border border-app-border rounded-xl p-4 text-left hover:border-sky-500/50 transition-all group"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>
          {icon}
        </div>
        <span className="text-sm font-semibold text-white group-hover:text-sky-300 transition-colors">{title}</span>
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{desc}</p>
      <div className="mt-3 text-[10px] font-semibold text-sky-400 uppercase tracking-wider flex items-center gap-1">
        Open
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { alerts } = useContext(DataContext);

  const activeFindings = useMemo(() => (alerts || []).filter(a => !a.acknowledged), [alerts]);

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">HSL Design Validator</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Offline AI assistant · {CLASS_SOCIETIES.length} class societies indexed · {DOMAINS.length} engineering domains
          </p>
        </div>
      </div>

      {/* Quick action tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickTile to="/chatbot" accent="bg-sky-500/15 text-sky-400" title="Ask the Assistant"
          desc="Natural-language queries on Class, IMO, IEC, Naval rules and build specs."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>}
        />
        <QuickTile to="/documents" accent="bg-emerald-500/15 text-emerald-400" title="Document Intelligence"
          desc="Upload, OCR-extract, compare and convert scanned PDFs to Word/Excel/ODF."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
        />
        <QuickTile to="/documents" accent="bg-violet-500/15 text-violet-400" title="Rule Validator"
          desc="Cross-reference Build Specs against IRS/DNV/ABS/IACS, IMO and IEC."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
        />
        <QuickTile to="/visualizer" accent="bg-amber-500/15 text-amber-400" title="3D Design Viewer"
          desc="Interactive hull/compartment model with live compliance overlays."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /></svg>}
        />
      </div>

      {/* Live Findings */}
      <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Live Findings</h3>
          <span className="text-[10px] text-slate-500">{activeFindings.length} active</span>
        </div>
        <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto">
          {activeFindings.length === 0 && (
            <div className="text-[11px] text-slate-500 text-center py-6">No active findings. Run a validation scan in Document Intelligence to check compliance.</div>
          )}
          {activeFindings.map(a => {
            const dot = a.type === 'critical' ? 'bg-red-500' : a.type === 'warning' ? 'bg-amber-500' : 'bg-sky-500';
            return (
              <button
                key={a.alertId}
                onClick={() => navigate('/documents')}
                className="w-full text-left p-2 rounded hover:bg-white/[0.03] border border-transparent hover:border-white/[0.06] transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 ${dot} shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-slate-200 leading-tight truncate">{a.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">{a.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">{a.zone}</span>
                      <span className="text-[9px] text-slate-600">·</span>
                      <span className="text-[9px] text-slate-500">{a.assetId}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer — security banner */}
      <div className="bg-app-panel border border-app-border rounded-xl px-4 py-3 flex flex-wrap items-center gap-4 text-[11px]">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          Air-gapped · No cloud egress
        </div>
        <div className="text-slate-500">RBAC enforced</div>
        <div className="text-slate-500">Audit trail active</div>
        <div className="text-slate-500">Defence-grade cipher · AES-256 · TLS 1.3 intranet only</div>
      </div>
    </div>
  );
}
