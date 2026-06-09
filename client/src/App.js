import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SocketProvider } from './services/socket';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard     from './pages/Dashboard';
import Chatbot       from './pages/Chatbot';
import Documents     from './pages/Documents';
import Settings      from './pages/Settings';
import UserManagement from './pages/UserManagement';
import Login         from './pages/Login';
import Layout        from './components/Layout';
import DrawingExtract    from './pages/DrawingExtract';
import InspectionReports from './pages/InspectionReports';
import LessonsLearned    from './pages/LessonsLearned';
import TechnicalOffer    from './pages/TechnicalOffer';
import BindingData       from './pages/BindingData';
import PreBidQueries     from './pages/PreBidQueries';
import DesignReview      from './pages/DesignReview';
import { getBaseKnowledge } from './services/aiService';
import { hasBaseDocs, cacheBaseDocs } from './services/docStore';

// On first authenticated load on this machine, parse + cache the built-in
// knowledge-base documents in the browser so they persist across all sessions.
// They are internal to the AI/RAG engine and are never shown in the UI.
function useBaseKnowledgeCache(user) {
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        if (await hasBaseDocs()) return;
        const { docs } = await getBaseKnowledge();
        if (!cancelled && docs?.length) await cacheBaseDocs(docs);
      } catch (_) { /* will retry next session */ }
    })();
    return () => { cancelled = true; };
  }, [user]);
}

// Guard that redirects non-admins back to dashboard
function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  useBaseKnowledgeCache(user);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('app_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const handleThemeToggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen"
        style={{ background: 'var(--app-darker, #0a0d14)', color: 'var(--app-text-faint, #6b7280)' }}>
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*"      element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout user={user} onLogout={logout} theme={theme} onThemeToggle={handleThemeToggle}>
      {/* Per-route boundary: a single page crash shows a recoverable fallback
          within the shell; navigating elsewhere (new key) clears it. */}
      <ErrorBoundary key={location.pathname}>
      <Routes>
        {/* Shared routes (both roles) */}
        <Route path="/"              element={<Dashboard />} />
        <Route path="/chatbot"       element={<Chatbot />} />
        <Route path="/documents"     element={<Documents />} />
        <Route path="/drawings"      element={<DrawingExtract />} />
        <Route path="/inspection"    element={<InspectionReports />} />
        <Route path="/lessons"       element={<LessonsLearned />} />
        <Route path="/compliance"    element={<TechnicalOffer />} />
        <Route path="/binding"       element={<BindingData />} />
        <Route path="/prebid"        element={<PreBidQueries />} />
        <Route path="/design-review" element={<DesignReview />} />

        {/* Admin-only routes */}
        <Route path="/settings"       element={<AdminRoute><Settings /></AdminRoute>} />
        <Route path="/users"          element={<AdminRoute><UserManagement /></AdminRoute>} />

        {/* Redirect login → home when already authenticated */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*"      element={<Navigate to="/" />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </Router>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
