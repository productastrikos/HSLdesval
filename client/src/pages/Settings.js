import React, { useState, useEffect, useCallback } from 'react';
import { testConnection, getKbStatus } from '../services/aiService';

function StatusDot({ ok }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />;
}

export default function Settings() {
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [kbStatus,   setKbStatus]   = useState(null);
  const [kbLoading,  setKbLoading]  = useState(true);

  const refreshKb = useCallback(async () => {
    setKbLoading(true);
    try { setKbStatus(await getKbStatus()); }
    catch (_) { setKbStatus(null); }
    setKbLoading(false);
  }, []);

  useEffect(() => { refreshKb(); }, [refreshKb]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection();
      setTestResult({ ok: true, msg: `Inference engine online · ${res.chunks} knowledge chunks indexed` });
      setKbStatus(res);
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  return (
    <div className="h-full overflow-y-auto p-1 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Verify the on-premise inference engine and review the built-in knowledge base.
        </p>
      </div>

      {/* ── Inference engine ──────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-white">On-Premise Inference Engine</h2>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          All language and vision processing runs locally on the appliance. No documents, queries or
          credentials ever leave the network — the system is fully self-contained and air-gapped.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={runTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-app-border text-[11px] font-semibold text-slate-300 hover:bg-white/[0.04] transition-colors disabled:opacity-50"
          >
            {testing ? (
              <><svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Testing…</>
            ) : (
              <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Test Connection</>
            )}
          </button>

          {testResult && (
            <div className={`flex items-center gap-1.5 text-[11px] ${testResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              <StatusDot ok={testResult.ok} />
              {testResult.msg}
            </div>
          )}
        </div>
      </div>

      {/* ── Knowledge Base ────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Knowledge Base</h2>
          <button onClick={refreshKb} className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1">
            <svg className={`w-3 h-3 ${kbLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          The engine is grounded in a built-in maritime rule base (IRS, IACS, IMO MARPOL/SOLAS, IEC 60092,
          DNV and ABS) used for retrieval. These reference sources are internal to the engine. Upload your
          own documents from the <span className="text-sky-400">Document Intelligence</span> page — they
          stay in your workspace for the session and power every tool.
        </p>

        {kbStatus ? (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
              <div className="text-xl font-bold text-violet-400">{(kbStatus.chunks || 0).toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 uppercase mt-0.5">Knowledge Chunks</div>
            </div>
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
              <div className="text-xl font-bold text-sky-400">{(kbStatus.vectorsIndexed || 0).toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 uppercase mt-0.5">Vectors Indexed</div>
            </div>
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
              <div className="text-xl font-bold text-emerald-400">{kbStatus.ready ? 'Ready' : 'Loading'}</div>
              <div className="text-[10px] text-slate-500 uppercase mt-0.5">Engine State</div>
            </div>
          </div>
        ) : kbLoading ? (
          <div className="text-[11px] text-slate-500">Loading status…</div>
        ) : (
          <div className="text-[11px] text-red-400">
            Backend server not reachable. Start the system with <code className="font-mono bg-slate-800 px-1 rounded">npm run dev</code> from the project root.
          </div>
        )}
      </div>

      {/* ── Quick Start ───────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white">Quick Start</h2>
        <div className="space-y-2 text-[11px] text-slate-400">
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">1.</span>
            <span>Start the full stack: <code className="font-mono bg-slate-800 text-slate-200 px-1.5 py-0.5 rounded">npm run dev</code> from the project root (runs both server + client).</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">2.</span>
            <span>Click <span className="text-white font-semibold">Test Connection</span> above to confirm the engine is running and the knowledge base is loaded.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">3.</span>
            <span>Upload your documents in <span className="text-sky-400">Document Intelligence</span> — they are read (with vision for scanned pages) and classified automatically.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">4.</span>
            <span>Use the <span className="text-sky-400">Rules &amp; Regulations Assistant</span> and the analysis tools — each lets you pick one of your uploaded documents.</span>
          </div>
        </div>
      </div>

      {/* ── Engine info ───────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-4 text-[11px] text-slate-400 flex items-center justify-between">
        <div>
          <span className="text-white font-semibold">Engine:</span>{' '}
          On-premise LLM · Hybrid BM25 + semantic retrieval · Local vision OCR
        </div>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">HSL Design Validator</span>
      </div>
    </div>
  );
}
