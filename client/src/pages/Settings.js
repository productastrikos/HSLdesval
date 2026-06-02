import React, { useState, useEffect, useCallback } from 'react';
import {
  testConnection, getKbStatus,
} from '../services/aiService';

function StatusDot({ ok }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
  );
}

export default function Settings() {
  const [testing,     setTesting]     = useState(false);
  const [testResult,  setTestResult]  = useState(null);
  const [kbStatus,    setKbStatus]    = useState(null);
  const [kbLoading,   setKbLoading]   = useState(true);

  const refreshKb = useCallback(async () => {
    setKbLoading(true);
    try {
      const s = await getKbStatus();
      setKbStatus(s);
    } catch (_) {
      setKbStatus(null);
    }
    setKbLoading(false);
  }, []);

  useEffect(() => { refreshKb(); }, [refreshKb]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection();
      setTestResult({ ok: true, msg: `Backend reachable · ${res.documents} documents · ${res.chunks} chunks indexed` });
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
          Manage the knowledge base and verify the AI backend connection.
        </p>
      </div>

      {/* ── Backend Connection ────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-white">Backend Connection</h2>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          The Gemini API key is configured in <code className="font-mono bg-slate-800 text-slate-200 px-1 rounded">server/.env</code> — no browser configuration required.
          All AI calls are made server-side; the key is never exposed to the client.
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
          The knowledge base is pre-loaded with IRS, IACS, IMO (MARPOL/SOLAS), IEC 60092, DNV, and ABS
          rule excerpts used for RAG retrieval. Upload additional documents (PDFs, DOCX) from the
          Document Intelligence page to expand the knowledge base.
        </p>

        {kbStatus ? (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <div className="text-xl font-bold text-sky-400">{kbStatus.documents}</div>
                <div className="text-[10px] text-slate-500 uppercase mt-0.5">Documents</div>
              </div>
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <div className="text-xl font-bold text-violet-400">{kbStatus.chunks}</div>
                <div className="text-[10px] text-slate-500 uppercase mt-0.5">Chunks</div>
              </div>
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <div className="text-xl font-bold text-emerald-400">{kbStatus.docs?.filter(d => !d.id.startsWith('STATIC')).length || 0}</div>
                <div className="text-[10px] text-slate-500 uppercase mt-0.5">User Uploads</div>
              </div>
            </div>

            {kbStatus.docs && kbStatus.docs.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-app-border">
                <table className="w-full text-[11px]">
                  <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.02] sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Document</th>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-right px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {kbStatus.docs.map(d => (
                      <tr key={d.id} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-slate-200">{d.name}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                            d.id.startsWith('STATIC')
                              ? 'bg-slate-700 text-slate-300 border-slate-600'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          }`}>{d.type}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500 font-mono text-[9px]">
                          {d.id.startsWith('STATIC') ? 'pre-loaded' : 'uploaded'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : kbLoading ? (
          <div className="text-[11px] text-slate-500">Loading KB status…</div>
        ) : (
          <div className="text-[11px] text-red-400">
            Backend server not reachable. Start the server with <code className="font-mono bg-slate-800 px-1 rounded">npm run dev</code> from the project root.
          </div>
        )}
      </div>

      {/* ── How to run ────────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white">Quick Start</h2>
        <div className="space-y-2 text-[11px] text-slate-400">
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">1.</span>
            <span>Start the full stack: <code className="font-mono bg-slate-800 text-slate-200 px-1.5 py-0.5 rounded">npm run dev</code> from the project root (runs both server + client).</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">2.</span>
            <span>Add your Gemini API key to <code className="font-mono bg-slate-800 text-slate-200 px-1 rounded">server/.env</code> as <code className="font-mono bg-slate-800 text-slate-200 px-1 rounded">GEMINI_API_KEY=...</code>.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">3.</span>
            <span>Click <span className="text-white font-semibold">Test Connection</span> above to confirm the backend is running and the KB is loaded.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">4.</span>
            <span>Upload your documents in <span className="text-sky-400">Document Intelligence</span> — PDFs and DOCX are extracted and indexed automatically.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">5.</span>
            <span>Use the <span className="text-sky-400">Design Assistant</span> to ask questions grounded in the knowledge base, or run the <span className="text-sky-400">Rule Validator</span> and <span className="text-sky-400">Spec Generator</span> for AI-powered outputs.</span>
          </div>
        </div>
      </div>

      {/* ── Model info ────────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-4 text-[11px] text-slate-400 flex items-center justify-between">
        <div>
          <span className="text-white font-semibold">Model:</span>{' '}
          gemini-2.0-flash · RAG: TF-IDF in-memory · Chunks: 200 words / 40 overlap
        </div>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">HSL Design Validator</span>
      </div>
    </div>
  );
}
