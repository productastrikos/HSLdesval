import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// ── Browser self-heal ─────────────────────────────────────────────────────────
// "Cannot reach the server" in a normal browser while incognito works is the
// signature of a stale *service worker* hijacking our requests. This app never
// registered one — but service workers are per-ORIGIN, so one left behind by a
// previous project on this same localhost port (or an old build) will intercept
// our fetches and break uploads. Proactively unregister any SW and drop its
// Cache Storage on startup. Safe no-op when there's nothing registered, and it
// does NOT touch uploaded documents (those live in IndexedDB, not Cache Storage).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
}
if (typeof caches !== 'undefined' && caches.keys) {
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ErrorBoundary fullPage>
    <App />
  </ErrorBoundary>
);
