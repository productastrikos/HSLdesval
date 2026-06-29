import React, { useState, useRef, useEffect, useMemo } from 'react';
import { chat } from '../services/aiService';
import { listSelectableDocs, getSelectableDoc } from '../services/docStore';
import { RULE_CORPUS, DOMAINS } from '../services/hslKnowledge';
import { RichText, FeedbackBar } from '../components/feature/FeatureKit';

// ── Session persistence ───────────────────────────────────────────────────────
const SESSIONS_KEY = 'hsl_chat_sessions';

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || []; }
  catch { return []; }
}

function saveSessions(sessions) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); }
  catch { /* quota exceeded */ }
}

function makeWelcomeMsg() {
  return {
    id:        'welcome-' + Date.now(),
    role:      'assistant',
    isWelcome: true,
    content:   "Welcome to the HSL Rules & Regulations Assistant.\n\nI'm grounded on the built-in reference knowledge base — SOLAS, the LSA Code, the Classification Rules and the Build Specification — and on any documents you upload. Ask me to validate Build Specifications, extract or estimate data, generate technical specs, or perform engineering calculations. Answers with structured data come as tables you can copy straight into Excel.\n\nTo compare two documents, use the Document Comparison page. Upload a document on the Documents page and select it here as reference context, try a suggested prompt, or ask anything about your vessel design.",
    timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
    mode:      'ai',
  };
}

function createSession(domain = 'All') {
  return {
    id:        'session-' + Date.now(),
    title:     'New conversation',
    createdAt: new Date().toISOString(),
    domain,
    messages:  [makeWelcomeMsg()],
  };
}

function formatDate(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

// ── Single chat message ───────────────────────────────────────────────────────
function Message({ msg, onSend }) {
  const isUser = msg.role === 'user';
  const showFeedback = !isUser && !msg.isWelcome && msg.mode !== 'error';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
        isUser ? 'bg-slate-700 text-slate-200' : 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-lg'
      }`}>
        {isUser ? 'U' : 'AI'}
      </div>
      <div className={`max-w-3xl ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-2.5 ${
          isUser ? 'bg-slate-700/60 text-slate-100 rounded-tr-sm' : 'bg-app-panel border border-app-border rounded-tl-sm'
        }`}>
          <RichText text={msg.content} />
          {!isUser && msg.citations && msg.citations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {msg.citations.map((c, i) => (
                <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">{c}</span>
              ))}
            </div>
          )}
          {!isUser && msg.contextUsed > 0 && (
            <div className="mt-1.5 text-[9px] text-slate-600 flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              {msg.contextUsed} KB chunks retrieved
            </div>
          )}
          {/* Follow-up question suggestions (Part-E #1: support follow-up questions) */}
          {!isUser && msg.followups?.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-app-border">
              <div className="text-[9px] uppercase tracking-widest text-slate-600 font-bold mb-1.5">Follow-up questions</div>
              <div className="flex flex-wrap gap-1.5">
                {msg.followups.map((f, i) => (
                  <button key={i} onClick={() => onSend && onSend(f)}
                    className="text-left text-[10px] px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-app-border hover:bg-sky-500/[0.06] hover:border-sky-500/30 text-slate-300">
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="text-[9px] text-slate-600 mt-1 px-2">{msg.timestamp}</div>
        {showFeedback && (
          <div className="w-full max-w-3xl px-2">
            <FeedbackBar module="chatbot" subject={(msg.content || '').slice(0, 60)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Chatbot page ─────────────────────────────────────────────────────────
export default function Chatbot() {
  // ── Session state ─────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState(() => {
    const saved = loadSessions();
    if (saved.length === 0) {
      const initial = createSession();
      saveSessions([initial]);
      return [initial];
    }
    return saved;
  });

  const [activeId, setActiveId] = useState(() => {
    const saved = loadSessions();
    return saved.length > 0 ? saved[0].id : null;
  });

  const [confirmClear, setConfirmClear] = useState(false);

  // Sync activeId if it points to a deleted session
  useEffect(() => {
    if (sessions.length > 0 && !sessions.find(s => s.id === activeId)) {
      setActiveId(sessions[0].id);
    }
  }, [sessions, activeId]);

  const activeSession  = useMemo(() => sessions.find(s => s.id === activeId) || sessions[0], [sessions, activeId]);
  const messages       = useMemo(() => activeSession?.messages || [], [activeSession]);
  const contextDomain  = activeSession?.domain   || 'All';

  // ── UI state ──────────────────────────────────────────────────────────────
  const [input,        setInput]        = useState('');
  const [isThinking,   setIsThinking]   = useState(false);
  const [, setError]                    = useState(null);
  const [chatDoc,      setChatDoc]      = useState(null);
  const [userDocs,     setUserDocs]     = useState([]);
  const endRef      = useRef(null);

  // Prefill the input when "Continue in Assistant" is used from Interaction History.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('continuePrompt');
      if (pending) { setInput(pending); sessionStorage.removeItem('continuePrompt'); }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const load = () => listSelectableDocs().then(setUserDocs).catch(() => setUserDocs([]));
    load();
    window.addEventListener('docstore:changed', load);
    return () => window.removeEventListener('docstore:changed', load);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // ── Session handlers ──────────────────────────────────────────────────────
  const handleNewSession = () => {
    const s    = createSession(contextDomain);
    const next = [s, ...sessions];
    setSessions(next);
    setActiveId(s.id);
    saveSessions(next);
    setInput('');
  };

  const handleDeleteSession = (id) => {
    const next = sessions.filter(s => s.id !== id);
    if (next.length === 0) {
      const fresh = createSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
      saveSessions([fresh]);
      return;
    }
    setSessions(next);
    saveSessions(next);
    if (activeId === id) setActiveId(next[0].id);
  };

  const handleClearAll = () => {
    const fresh = createSession();
    setSessions([fresh]);
    setActiveId(fresh.id);
    saveSessions([fresh]);
    setConfirmClear(false);
    setInput('');
  };

  const handleDomainChange = (domain) => {
    const next = sessions.map(s => s.id === activeId ? { ...s, domain } : s);
    setSessions(next);
    saveSessions(next);
  };

  // Append a message to a specific session (safe for async use)
  const appendToSession = (sessionId, msg) => {
    setSessions(prev => {
      const next = prev.map(s =>
        s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s
      );
      saveSessions(next);
      return next;
    });
  };

  // ── Reference document selection (from the user's uploaded documents) ────
  const handleDocSelect = async (id) => {
    if (!id) { setChatDoc(null); return; }
    const d = await getSelectableDoc(id);
    if (!d) return;
    setChatDoc({
      id: d.id,
      name: d.name,
      text: d.text,
      suggestions: [
        `Summarise the key requirements in ${d.name}.`,
        `What compliance risks or gaps stand out in ${d.name}?`,
        `List the technical specifications stated in ${d.name}.`,
        `Cross-reference ${d.name} against applicable Class and IMO rules.`,
        `What clarifications should we seek based on ${d.name}?`,
        `Identify any inconsistencies or ambiguities in ${d.name}.`,
      ],
    });
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || isThinking) return;
    setInput('');
    setError(null);

    const sessionId   = activeId;
    const currentMsgs = messages;
    const domain      = contextDomain;
    const now         = Date.now();

    const userMsg = {
      id:        'u' + now,
      role:      'user',
      content:   q,
      timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
    };

    // Add user message + auto-title from first user message
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== sessionId) return s;
        const isFirst = !s.messages.some(m => m.role === 'user');
        return {
          ...s,
          title:    isFirst ? (q.length > 38 ? q.slice(0, 38) + '…' : q) : s.title,
          messages: [...s.messages, userMsg],
        };
      });
      saveSessions(next);
      return next;
    });

    setIsThinking(true);
    const startTime = Date.now();

    try {
      const history = [...currentMsgs, userMsg]
        .filter(m => !m.isWelcome)
        .map(m => ({ role: m.role, content: m.content }));

      const resp = await chat(history, domain === 'All' ? undefined : domain, chatDoc?.text, chatDoc?.name, 'Rules & Regulations Assistant');

      appendToSession(sessionId, {
        id:          'a' + Date.now(),
        role:        'assistant',
        content:     resp.content,
        citations:   resp.citations   || [],
        contextUsed: resp.contextUsed || 0,
        followups:   resp.followups   || [],
        timestamp:   new Date().toLocaleTimeString('en-IN', { hour12: false }),
        latencyMs:   Date.now() - startTime,
        mode:        'ai',
      });
    } catch (e) {
      setError(e.message);
      appendToSession(sessionId, {
        id:        'err' + Date.now(),
        role:      'assistant',
        content:   `⚠ Error: ${e.message}\n\nPlease try again in a moment.`,
        timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false }),
        mode:      'error',
      });
    }

    setIsThinking(false);
  };

  const onKey  = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="h-full flex gap-3">

      {/* ── Sessions sidebar ─────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col overflow-hidden bg-app-panel border border-app-border rounded-xl">

        {/* Header */}
        <div className="px-3 py-2.5 border-b border-app-border flex items-center justify-between shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Chat History</span>
          <button
            onClick={handleNewSession}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border border-sky-500/30 transition-colors"
            title="New conversation"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1 min-h-0">
          {sessions.map(session => {
            const userMsgCount = session.messages.filter(m => m.role === 'user').length;
            const isActive     = session.id === activeId;
            return (
              <div
                key={session.id}
                onClick={() => setActiveId(session.id)}
                className={`group flex items-start gap-2 px-2.5 py-2.5 cursor-pointer transition-colors border-l-2 ${
                  isActive ? 'bg-sky-500/[0.08] border-l-sky-500' : 'border-l-transparent hover:bg-white/[0.03]'
                }`}
              >
                <svg
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-600'}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className={`text-[11px] font-medium truncate leading-tight ${isActive ? 'text-white' : 'text-slate-300'}`}>
                    {session.title}
                  </div>
                  <div className="text-[9px] text-slate-600 mt-0.5 flex items-center gap-1">
                    <span>{formatDate(session.createdAt)}</span>
                    {userMsgCount > 0 && (
                      <>
                        <span>·</span>
                        <span>{userMsgCount} msg{userMsgCount !== 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                  title="Delete session"
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 text-slate-600 mt-0.5"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Domain filter */}
        <div className="px-3 py-2.5 border-t border-app-border shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Domain Focus</div>
          <select
            value={contextDomain}
            onChange={e => handleDomainChange(e.target.value)}
            className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
          >
            <option value="All">All domains</option>
            {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Clear all */}
        <div className="px-3 py-2 border-t border-app-border shrink-0">
          {confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-red-400 flex-1">Clear all sessions?</span>
              <button
                onClick={handleClearAll}
                className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 font-semibold"
              >Yes</button>
              <button
                onClick={() => setConfirmClear(false)}
                className="text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] border border-app-border"
              >No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="w-full text-[10px] text-slate-600 hover:text-red-400 flex items-center justify-center gap-1.5 py-1 rounded hover:bg-red-500/10 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear all sessions
            </button>
          )}
        </div>
      </aside>

      {/* ── Main chat panel ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-app-panel border border-app-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">AI</div>
            <div>
              <div className="text-sm font-bold text-white">Rules &amp; Regulations Assistant</div>
              <div className="text-[10px] text-slate-500">
                Domain: <span className="text-sky-400">{contextDomain}</span>
              </div>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            AI online
          </span>
        </div>

        {/* Chat scroll area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(m => <Message key={m.id} msg={m} onSend={send} />)}
          {isThinking && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">AI</div>
              <div className="bg-app-panel border border-app-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="text-[10px] text-slate-500 ml-1">Thinking…</span>
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
              placeholder="Ask about a rule, validate a spec, generate documentation, run a calculation…"
              className="flex-1 bg-transparent text-[13px] text-slate-200 placeholder-slate-500 outline-none resize-none max-h-32 py-1"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || isThinking}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center gap-1"
            >
              Send
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
          <div className="text-[10px] text-slate-600 mt-1.5 px-1">Enter to send · Shift+Enter new line</div>
        </div>
      </div>

      {/* ── Right sidebar ────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">

        {/* Reference document picker */}
        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Reference Document</div>
          {userDocs.length === 0 ? (
            <p className="text-[10px] text-slate-600 leading-relaxed">
              No documents yet. Upload one on the <span className="text-sky-400">Documents</span> page, then select it here to use as conversation context.
            </p>
          ) : (
            <>
              <select
                value={chatDoc?.id || ''}
                onChange={(e) => handleDocSelect(e.target.value)}
                className="w-full text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
              >
                <option value="">No reference document</option>
                {userDocs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.type}</option>)}
              </select>
              {chatDoc && (
                <div className="flex items-start gap-2 bg-emerald-500/[0.06] border border-emerald-500/30 rounded-lg p-2 mt-2">
                  <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-emerald-300 truncate">{chatDoc.name}</div>
                    <div className="text-[10px] text-slate-500">{Math.ceil((chatDoc.text?.length || 0) / 1000)}K chars · active as context</div>
                  </div>
                  <button
                    onClick={() => setChatDoc(null)}
                    className="shrink-0 text-slate-500 hover:text-red-400 transition-colors"
                    title="Remove reference"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Suggested prompts — dynamic from uploaded doc */}
        <div className="bg-app-panel border border-app-border rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Suggested prompts</div>
          {chatDoc?.suggestions?.length > 0 ? (
            <div className="space-y-1.5">
              {chatDoc.suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  disabled={isThinking}
                  className="w-full text-left text-[11px] px-2.5 py-2 rounded-lg bg-white/[0.02] border border-app-border hover:bg-sky-500/[0.06] hover:border-sky-500/30 hover:text-sky-200 text-slate-300 transition-colors disabled:opacity-40"
                >
                  <span className="leading-snug">{s}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-slate-600 leading-relaxed">
              Select a reference document above to see document-specific prompt suggestions.
            </div>
          )}
        </div>

        {/* Quick reference rules */}
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
