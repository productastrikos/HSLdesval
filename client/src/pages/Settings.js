import React, { useState, useEffect, useCallback } from 'react';
import {
  getApiKey, setApiKey, clearApiKey, isConfigured,
  testConnection, getKbStatus,
} from '../services/aiService';

function StatusDot({ ok }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
  );
}

export default function Settings() {
  const [keyInput,    setKeyInput]    = useState(() => getApiKey());
  const [masked,      setMasked]      = useState(true);
  const [saved,       setSaved]       = useState(false);
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

  const save = () => {
    setApiKey(keyInput);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const clear = () => {
    clearApiKey();
    setKeyInput('');
    setTestResult(null);
  };

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

  const configured = isConfigured();

  return (
    <div className="h-full overflow-y-auto p-1 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Configure the AI backend connection and manage the knowledge base.
        </p>
      </div>

      {/* ── API Key ───────────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-white">Anthropic API Key</h2>
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
            configured
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          }`}>
            {configured ? 'Configured' : 'Not Set'}
          </span>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          The API key is stored locally in your browser and forwarded to the
          backend server per request. It is never transmitted externally — all
          calls go to the local backend (localhost:5001) which then calls Anthropic.
        </p>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={masked ? 'password' : 'text'}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-ant-api03-…"
              className="w-full text-[12px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono pr-10 focus:outline-none focus:border-sky-500/60"
            />
            <button
              onClick={() => setMasked(m => !m)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              title={masked ? 'Show key' : 'Hide key'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {masked
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0zm-10.94-.494C5.905 8.102 8.763 6 12 6c3.238 0 6.095 2.102 7.94 5.506M4.06 11.506C5.905 15.9 8.763 18 12 18c3.238 0 6.095-2.1 7.94-6.494" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                }
              </svg>
            </button>
          </div>
          <button
            onClick={save}
            disabled={!keyInput.trim()}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-xs font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saved ? '✓ Saved' : 'Save Key'}
          </button>
          {configured && (
            <button
              onClick={clear}
              className="px-3 py-2 rounded-lg text-red-400 border border-red-500/30 text-xs font-semibold hover:bg-red-500/10 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

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
            <span>Paste your Anthropic API key above and click <span className="text-white font-semibold">Save Key</span>.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sky-400 font-mono font-bold mt-0.5">3.</span>
            <span>Click <span className="text-white font-semibold">Test Connection</span> to confirm the backend is running and the KB is loaded.</span>
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
          claude-sonnet-4-6 (latest) · RAG: TF-IDF in-memory · Chunks: 200 words / 40 overlap
        </div>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">HSL Design Validator</span>
      </div>
    </div>
  );
}
