import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { chat, isConfigured } from '../services/aiService';
import { generateResponse, SUGGESTIONS, RULE_CORPUS, BUILD_SPECS, INDEXED_DOCS, DOMAINS } from '../services/hslKnowledge';

// ── Formatted message text with basic markdown ────────────────────────────────
function FormattedText({ text }) {
  const lines = (text || '').split('\n');
  return (
    <div className="text-[13px] leading-relaxed text-slate-200 space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <p key={i} className="font-bold text-white text-[12px] uppercase tracking-widest mt-2">{line.slice(4)}</p>;
        if (line.startsWith('## '))  return <p key={i} className="font-bold text-white mt-2">{line.slice(3)}</p>;
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-bold text-white">{line.slice(2, -2)}</p>;
        if (line.startsWith('- ') || line.startsWith('• ')) return <p key={i} className="pl-3">· {line.slice(2)}</p>;
        if (/^\d+\.\s/.test(line)) return <p key={i} className="pl-3">{line}</p>;
        if (line.trim() === '') return null;
        // Inline bold: replace **text** with styled span
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i}>
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={j} className="text-white font-semibold">{p.slice(2, -2)}</strong>
                : p
            )}
          </p>
        );
      })}
    </div>
  );
}

// ── Single chat message ───────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
        isUser
          ? 'bg-slate-700 text-slate-200'
          : 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-lg'
      }`}>
        {isUser ? 'U' : 'AI'}
      </div>
      <div className={`max-w-3xl ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-2.5 ${isUser
          ? 'bg-slate-700/60 text-slate-100 rounded-tr-sm'
          : 'bg-app-panel border border-app-border rounded-tl-sm'}`}>
          <FormattedText text={msg.content} />

          {/* Citations */}
          {!isUser && msg.citations && msg.citations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {msg.citations.map((c, i) => (
                <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">{c}</span>
              ))}
            </div>
          )}

          {/* Context used indicator */}
          {!isUser && msg.contextUsed > 0 && (
            <div className="mt-1.5 text-[9px] text-slate-600 flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              {msg.contextUsed} KB chunks retrieved
            </div>
          )}
        </div>
        <div className="text-[9px] text-slate-600 mt-1 px-2">
          {msg.timestamp}
          {!isUser && msg.latencyMs && (
            <span> · {msg.latencyMs} ms · {msg.mode === 'ai' ? 'Claude API + RAG' : 'demo mode'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AI not configured banner ──────────────────────────────────────────────────
function DemoBanner({ onGoToSettings }) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 bg-amber-500/[0.08] border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      <span className="flex-1">Demo mode — showing static responses. Configure your Anthropic API key to enable real AI with RAG.</span>
      <button onClick={onGoToSettings} className="shrink-0 font-bold hover:text-white transition-colors underline">Settings →</button>
    </div>
  );
}

// ── Main Chatbot page ─────────────────────────────────────────────────────────
export default function Chatbot() {
  const [messages, setMessages] = useState(() => [
    {
      id:        'welcome',
      role:      'assistant',
      content:   isConfigured()
        ? "Welcome to the HSL Design Assistant. I'm connected to Claude via the Anthropic API and grounded in your knowledge base.\n\nI can interpret Class (IRS/DNV/ABS/IACS), IMO, IEC and Naval rules, validate Build Specifications, generate technical specs, perform engineering calculations, and compare documents — all grounded in the uploaded knowledge base.\n\nTry a suggested prompt or ask anything in natural language."
        : "Welcome to the HSL Design Assistant (Demo Mode).\n\nI'm currently running on static knowledge. Configure your Anthropic API key in **Settings** to enable real AI responses grounded in the knowledge base.\n\nIn the meantime you can explore the static rule corpus below.",
      timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
      mode:      isConfigured() ? 'ai' : 'demo',
    },
  ]);
  const [input,         setInput]         = useState('');
  const [isThinking,    setIsThinking]    = useState(false);
  const [contextDomain, setContextDomain] = useState('All');
  const [, setError]         = useState(null);
  const endRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || isThinking) return;
    setInput('');
    setError(null);

    const now  = Date.now();
    const userMsg = {
      id:        'u' + now,
      role:      'user',
      content:   q,
      timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);

    const startTime = Date.now();

    if (isConfigured()) {
      // ── Real AI path ────────────────────────────────────────────────────
      try {
        const history = [...messages, userMsg]
          .filter(m => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
          .map(m => ({ role: m.role, content: m.content }));

        const resp = await chat(history, contextDomain === 'All' ? undefined : contextDomain);

        setMessages(prev => [...prev, {
          id:          'a' + Date.now(),
          role:        'assistant',
          content:     resp.content,
          citations:   resp.citations || [],
          contextUsed: resp.contextUsed || 0,
          timestamp:   new Date().toLocaleTimeString('en-IN', { hour12: false }),
          latencyMs:   Date.now() - startTime,
          mode:        'ai',
        }]);
      } catch (e) {
        setError(e.message);
        setMessages(prev => [...prev, {
          id:        'err' + Date.now(),
          role:      'assistant',
          content:   `⚠ Error: ${e.message}\n\nCheck your API key in Settings or ensure the backend server is running (npm run dev).`,
          timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
          mode:      'error',
        }]);
      }
    } else {
      // ── Demo fallback path ──────────────────────────────────────────────
      const lat = 700 + Math.floor(Math.random() * 600);
      await new Promise(r => setTimeout(r, lat));
      const resp = generateResponse(q);
      setMessages(prev => [...prev, {
        id:        'a' + Date.now(),
        role:      'assistant',
        content:   resp.summary,
        citations: resp.citations || [],
        timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
        latencyMs: lat,
        mode:      'demo',
      }]);
    }

    setIsThinking(false);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const stats = useMemo(() => ({
    rules: RULE_CORPUS.length,
    docs:  INDEXED_DOCS.length,
    specs: BUILD_SPECS.length,
    msgs:  messages.filter(m => m.role === 'user').length,
  }), [messages]);

  const aiMode = isConfigured();

  return (
    <div className="h-full flex gap-3">
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">
        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Domain Focus</div>
          <select
            value={contextDomain}
            onChange={e => setContextDomain(e.target.value)}
            className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
          >
            <option value="All">All domains</option>
            {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Capabilities</div>
          <ul className="space-y-1.5 text-[11px] text-slate-300">
            {[
              ['📖', 'Rule interpretation (IRS/DNV/ABS/IACS)'],
              ['🔍', 'Document Q&A via RAG'],
              ['📊', 'Document comparison'],
              ['📝', 'Specification drafting'],
              ['🧮', 'Engineering calculations'],
              ['🔗', 'Cross-reference multi-doc'],
              ['🖼', 'Scanned PDF / OCR analysis'],
            ].map(([i, t]) => (
              <li key={t} className="flex items-center gap-2"><span>{i}</span><span>{t}</span></li>
            ))}
          </ul>
        </div>

        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Session</div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div><div className="text-base font-bold text-sky-400">{stats.rules}</div><div className="text-[9px] text-slate-500 uppercase">Rules</div></div>
            <div><div className="text-base font-bold text-emerald-400">{stats.docs}</div><div className="text-[9px] text-slate-500 uppercase">Docs</div></div>
            <div><div className="text-base font-bold text-violet-400">{stats.specs}</div><div className="text-[9px] text-slate-500 uppercase">Specs</div></div>
            <div><div className="text-base font-bold text-amber-400">{stats.msgs}</div><div className="text-[9px] text-slate-500 uppercase">Queries</div></div>
          </div>
        </div>

        <div className={`rounded-xl p-3 text-[10px] leading-relaxed border ${
          aiMode
            ? 'bg-emerald-500/[0.04] border-emerald-500/30 text-emerald-300'
            : 'bg-amber-500/[0.04] border-amber-500/30 text-amber-300'
        }`}>
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${aiMode ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {aiMode ? 'CLAUDE AI + RAG ACTIVE' : 'DEMO MODE'}
          </div>
          {aiMode
            ? 'Claude API connected. Responses grounded in the knowledge base via TF-IDF RAG retrieval.'
            : 'Static responses only. Configure API key in Settings to activate real AI.'
          }
        </div>
      </aside>

      {/* ── Main chat panel ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-app-panel border border-app-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">AI</div>
            <div>
              <div className="text-sm font-bold text-white">HSL Design Assistant</div>
              <div className="text-[10px] text-slate-500">
                Domain: <span className="text-sky-400">{contextDomain}</span>
                {aiMode && <span className="ml-2 text-emerald-400">· RAG active</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`flex items-center gap-1 ${aiMode ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${aiMode ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              {aiMode ? 'Claude API online' : 'Demo mode'}
            </span>
            <button
              onClick={() => setMessages(prev => [prev[0]])}
              className="px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.04] border border-app-border"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Demo banner */}
        {!aiMode && <DemoBanner onGoToSettings={() => navigate('/settings')} />}

        {/* Chat scroll area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(m => <Message key={m.id} msg={m} />)}
          {isThinking && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">AI</div>
              <div className="bg-app-panel border border-app-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="text-[10px] text-slate-500 ml-1">
                  {aiMode ? 'Retrieving context and calling Claude…' : 'Retrieving from local index…'}
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-app-border p-3">
          <div className="flex items-end gap-2 bg-slate-900/40 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-sky-500/50 transition-colors">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder={aiMode
                ? "Ask about a rule, validate a spec, generate documentation, run a calculation…"
                : "Demo mode — configure API key in Settings for real AI responses…"
              }
              className="flex-1 bg-transparent text-[13px] text-slate-200 placeholder-slate-500 outline-none resize-none max-h-32 py-1"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || isThinking}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center gap-1"
            >
              Send
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
          </div>
          <div className="text-[10px] text-slate-600 mt-1.5 px-1">
            Enter to send · Shift+Enter new line
            {aiMode ? ' · Responses grounded in knowledge base via RAG' : ' · Demo mode — static responses'}
          </div>
        </div>
      </div>

      {/* ── Right sidebar ────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">
        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Suggested prompts</div>
          <div className="space-y-1.5">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => send(s.text)}
                disabled={isThinking}
                className="w-full text-left text-[11px] px-2.5 py-2 rounded-lg bg-white/[0.02] border border-app-border hover:bg-sky-500/[0.06] hover:border-sky-500/30 hover:text-sky-200 text-slate-300 transition-colors flex items-start gap-2 disabled:opacity-40"
              >
                <span className="shrink-0">{s.icon}</span>
                <span className="leading-snug">{s.text}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Quick reference</div>
          <div className="space-y-1.5 text-[10px]">
            {RULE_CORPUS.slice(0, 5).map(r => (
              <button
                key={r.id}
                onClick={() => send(`Explain ${r.id} — ${r.title}`)}
                disabled={isThinking}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-white/[0.03] text-slate-300 disabled:opacity-40"
              >
                <div className="font-mono font-bold text-sky-400">{r.id}</div>
                <div className="text-slate-500 truncate">{r.title}</div>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

