import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login }    = useAuth();
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [showPass,   setShowPass]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Enter username and password'); return; }
    setLoading(true); setError('');
    try {
      await login(username.trim(), password);
      // AuthContext sets user → AppRoutes re-renders → redirect happens automatically
    } catch (err) {
      setError(err.message || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--app-darker, #0a0d14)' }}
    >
      <div className="w-full max-w-sm px-4">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div style={{
            width: 56, height: 56, borderRadius: 16, flexShrink: 0,
            background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 60%,#8b5cf6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 24px rgba(99,102,241,0.40)',
          }}>
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17h18M5 17V9l7-5 7 5v8M9 17v-5h6v5" />
            </svg>
          </div>
          <h1 className="mt-4 text-[15px] font-extrabold tracking-tight text-white">HSL Design Validator</h1>
          <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--app-text-faint, #6b7280)' }}>
            AI · Offline · Secure Intranet
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-6"
          style={{
            background:   'var(--app-dark, #111827)',
            borderColor:  'var(--app-border, rgba(255,255,255,0.08))',
            boxShadow:    '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <h2 className="text-sm font-bold text-white mb-1">Sign in</h2>
          <p className="text-[11px] mb-5" style={{ color: 'var(--app-text-muted, #9ca3af)' }}>
            Use your Hindustan Shipyard credentials
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold mb-1.5"
                style={{ color: 'var(--app-text-faint, #6b7280)' }}>
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="your.username"
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg text-[12px] outline-none transition-colors"
                style={{
                  background:   'var(--app-darker, #0a0d14)',
                  border:       '1px solid var(--app-border, rgba(255,255,255,0.1))',
                  color:        'var(--app-text, #f1f5f9)',
                }}
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold mb-1.5"
                style={{ color: 'var(--app-text-faint, #6b7280)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  className="w-full px-3 py-2 pr-9 rounded-lg text-[12px] outline-none transition-colors"
                  style={{
                    background:   'var(--app-darker, #0a0d14)',
                    border:       '1px solid var(--app-border, rgba(255,255,255,0.1))',
                    color:        'var(--app-text, #f1f5f9)',
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--app-text-faint, #6b7280)' }}
                >
                  {showPass ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-white text-[12px] font-bold tracking-wide transition-opacity disabled:opacity-50"
              style={{
                background: loading
                  ? '#4b5563'
                  : 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 60%,#8b5cf6 100%)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Default credentials hint */}
          <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--app-border, rgba(255,255,255,0.06))' }}>
            <p className="text-[9px] uppercase tracking-widest font-bold mb-2"
              style={{ color: 'var(--app-text-faint, #6b7280)' }}>Default Accounts</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { role: 'Admin', username: 'admin', pass: 'admin123', color: 'text-violet-300', bg: 'bg-violet-500/10 border-violet-500/25' },
                { role: 'Engineer', username: 'engineer1', pass: 'engineer123', color: 'text-sky-300', bg: 'bg-sky-500/10 border-sky-500/25' },
              ].map(a => (
                <button
                  key={a.role}
                  type="button"
                  onClick={() => { setUsername(a.username); setPassword(a.pass); }}
                  className={`text-left px-2.5 py-2 rounded-lg border text-[10px] ${a.bg} hover:opacity-80 transition-opacity`}
                >
                  <div className={`font-bold ${a.color}`}>{a.role}</div>
                  <div style={{ color: 'var(--app-text-faint, #6b7280)' }}>{a.username}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Maker attribution — designed & developed by Astrikos */}
        <div className="flex flex-col items-center gap-1.5 mt-6">
          <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--app-text-faint, #6b7280)' }}>Designed &amp; developed by</span>
          <img src="/astrikos-logo.png" alt="Astrikos" style={{ height: 46, width: 'auto', maxWidth: 180, objectFit: 'contain' }} />
        </div>
      </div>
    </div>
  );
}
