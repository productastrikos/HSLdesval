import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './services/socket';
import { Chart as ChartJS } from 'chart.js';
import Dashboard from './pages/Dashboard';
import Chatbot from './pages/Chatbot';
import Documents from './pages/Documents';
import Validator from './pages/Validator';
import Specifications from './pages/Specifications';
import Visualizer3D from './pages/Visualizer3D';
import Compliance from './pages/Compliance';
import Settings from './pages/Settings';
import Layout from './components/Layout';

ChartJS.defaults.interaction.mode = 'index';
ChartJS.defaults.interaction.intersect = false;
ChartJS.defaults.plugins.tooltip.enabled = true;

const STATIC_USER = { fullName: 'Design Engineer', role: 'engineer' };

function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('app_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  });

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const handleThemeToggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <SocketProvider>
      <Router>
        <Layout user={STATIC_USER} theme={theme} onThemeToggle={handleThemeToggle}>
          <Routes>
            <Route path="/"                element={<Dashboard />} />
            <Route path="/chatbot"         element={<Chatbot />} />
            <Route path="/documents"       element={<Documents />} />
            <Route path="/validator"       element={<Validator />} />
            <Route path="/specifications"  element={<Specifications />} />
            <Route path="/visualizer"      element={<Visualizer3D />} />
            <Route path="/compliance"      element={<Compliance />} />
            <Route path="/settings"        element={<Settings />} />
            <Route path="*"                element={<Navigate to="/" />} />
          </Routes>
        </Layout>
      </Router>
    </SocketProvider>
  );
}

export default App;
