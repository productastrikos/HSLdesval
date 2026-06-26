import React, { createContext, useContext, useState, useEffect } from 'react';
import { clearUserDocs } from '../services/docStore';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const saved = localStorage.getItem('auth_user');
    if (token && saved) {
      try { setUser(JSON.parse(saved)); } catch (_) {}
    }
    setLoading(false);
  }, []);

  // Token-expiry / 401 handler dispatched by aiService
  useEffect(() => {
    const handler = () => {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      clearUserDocs();
      setUser(null);
    };
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, []);

  const login = async (username, password) => {
    let res;
    try {
      res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
    } catch (_) {
      throw new Error('Cannot reach the server. Please check that the application is running.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed. Please try again.');
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user',  JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    // Record the logout in the audit trail (fire-and-forget) before clearing the token.
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      } catch (_) {}
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    clearUserDocs();   // uploaded documents live only for the duration of the session
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
