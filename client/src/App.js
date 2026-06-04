import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './services/socket';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Chart as ChartJS } from 'chart.js';
import Dashboard     from './pages/Dashboard';
import Chatbot       from './pages/Chatbot';
import Documents     from './pages/Documents';
import Validator     from './pages/Validator';
import Specifications from './pages/Specifications';
import Visualizer3D  from './pages/Visualizer3D';
import Settings      from './pages/Settings';
import UserManagement from './pages/UserManagement';
import Login         from './pages/Login';
import Layout        from './components/Layout';

ChartJS.defaults.interaction.mode = 'index';
ChartJS.defaults.interaction.intersect = false;
ChartJS.defaults.plugins.tooltip.enabled = true;

// Guard that redirects non-admins back to dashboard
function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading, logout } = useAuth();

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
      <Routes>
        {/* Shared routes (both roles) */}
        <Route path="/"           element={<Dashboard />} />
        <Route path="/chatbot"    element={<Chatbot />} />
        <Route path="/documents"  element={<Documents />} />
        <Route path="/validator"  element={<Validator />} />
        <Route path="/visualizer" element={<Visualizer3D />} />

        {/* Admin-only routes */}
        <Route path="/specifications" element={<AdminRoute><Specifications /></AdminRoute>} />
        <Route path="/settings"       element={<AdminRoute><Settings /></AdminRoute>} />
        <Route path="/users"          element={<AdminRoute><UserManagement /></AdminRoute>} />

        {/* Redirect login → home when already authenticated */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*"      element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Router>
          <AppRoutes />
        </Router>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
