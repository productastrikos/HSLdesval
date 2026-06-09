import React from 'react';

// Catches render/runtime errors in the subtree and shows a recoverable fallback
// instead of unmounting the whole app (white screen). Two usages:
//   • top-level (index.js) — full-page safety net
//   • per-route (App.js)   — keyed by pathname so navigation clears the error
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logged for diagnostics; never shown raw to the user.
    console.error('[UI ErrorBoundary]', error, info && info.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className="flex items-center justify-center p-6"
        style={{ minHeight: this.props.fullPage ? '100vh' : '60vh', background: 'var(--app-darker, #0a0d14)' }}
      >
        <div
          className="max-w-md w-full rounded-2xl border p-6 text-center"
          style={{ background: 'var(--app-dark, #111827)', borderColor: 'var(--app-border, rgba(255,255,255,0.08))' }}
        >
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center bg-red-500/15 text-red-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-white">Something went wrong on this page</h2>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            The page hit an unexpected error. You can try again, or reload the application.
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={this.handleReset}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-200 border border-app-border hover:bg-white/[0.05] transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 hover:opacity-90 transition-opacity"
            >
              Reload application
            </button>
          </div>
        </div>
      </div>
    );
  }
}
