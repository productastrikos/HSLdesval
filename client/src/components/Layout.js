import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../services/socket';
import { isConfigured } from '../services/aiService';
import AlertPanel from './AlertPanel';
import AdvisoryPanel from './AdvisoryPanel';

/* ─── Navigation structure ─────────────────────────────── */
// roles: which roles can see this nav item
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { path: '/',               roles: ['admin','user'], icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4', label: 'Dashboard' },
    ],
  },
  {
    label: 'AI Assistant',
    items: [
      { path: '/chatbot',        roles: ['admin','user'], icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', label: 'Design Assistant' },
    ],
  },
  {
    label: 'Validation',
    items: [
      { path: '/documents',      roles: ['admin','user'], icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Document Intel' },
      { path: '/validator',      roles: ['admin','user'], icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', label: 'Rule Validator' },
      { path: '/specifications', roles: ['admin'],        icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2zM9 13h6M9 17h6M9 9h1', label: 'Spec Generator' },
    ],
  },
  {
    label: 'Visualization',
    items: [
      { path: '/visualizer',     roles: ['admin','user'], icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12', label: '3D Design Viewer' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { path: '/compliance',     roles: ['admin'],        icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', label: 'Compliance & Audit' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { path: '/users',          roles: ['admin'],        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', label: 'User Management' },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/settings',       roles: ['admin'],        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z', label: 'Settings & AI Config' },
    ],
  },
];

/* ─── Deep search index  ──────────────────────────────────
   Each entry: { label, path, breadcrumb, keywords, icon }
   breadcrumb = ['Page', 'Section', 'Item']  (shown in results)
   keywords   = extra words matched against (not displayed)
────────────────────────────────────────────────────────── */
const SEARCH_INDEX = [
  { label:'Dashboard',             path:'/',                breadcrumb:['Dashboard'],                            icon:'📊', keywords:'overview kpi summary home main metrics validator hsl', roles:['admin','user'] },
  { label:'Design Assistant',      path:'/chatbot',         breadcrumb:['AI Assistant','Chatbot'],               icon:'📊', keywords:'chatbot ai assistant query rule interpret design natural language nlp irs dnv abs iacs imo iec naval', roles:['admin','user'] },
  { label:'Document Intelligence', path:'/documents',       breadcrumb:['Validation','Document Intel'],          icon:'📋', keywords:'document intel ocr scanned pdf extraction parse manual equipment text searchable convert word excel odf', roles:['admin','user'] },
  { label:'Rule Validator',        path:'/validator',       breadcrumb:['Validation','Rule Validator'],          icon:'📈', keywords:'validate compliance rule class irs dnv abs iacs imo iec naval cross reference inconsistency', roles:['admin','user'] },
  { label:'Specification Generator',path:'/specifications', breadcrumb:['Validation','Spec Generator'],          icon:'📋', keywords:'specification generator equipment system technical spec build hvac electrical mechanical piping hull outfit', roles:['admin'] },
  { label:'3D Design Viewer',      path:'/visualizer',      breadcrumb:['Visualization','3D Viewer'],            icon:'🗺', keywords:'3d visualizer design viewer ship hull frames bulkhead compartment three dimensional model', roles:['admin','user'] },
  { label:'Compliance & Audit',    path:'/compliance',      breadcrumb:['Governance','Compliance'],              icon:'👥', keywords:'compliance audit trail traceability usage analytics access security defence cyber', roles:['admin'] },
  { label:'User Management',       path:'/users',           breadcrumb:['Administration','Users'],               icon:'👥', keywords:'users accounts roles admin engineer access management permissions', roles:['admin'] },
  { label:'Settings & AI Config',  path:'/settings',        breadcrumb:['System','Settings'],                    icon:'⚙', keywords:'settings api key anthropic claude ai configuration knowledge base kb rag backend server', roles:['admin'] },
];

/* ─── Icon helper ──────────────────────────────────────── */
function SvgIcon({ d, size = 'w-4 h-4', strokeWidth = 1.6 }) {
  return (
    <svg className={`${size} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
    </svg>
  );
}

/* Maps the legacy emoji icon keys in SEARCH_INDEX to SVG path strings */
const SEARCH_ICON_PATHS = {
  '📊': 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  '🗑': 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  '🚛': 'M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM3 17h2M17 17h2M1 9h18M13 3H1v14h12V3zM13 5h4l3 6H13V5z',
  '⚙': 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  '⚡':  'M13 10V3L4 14h7v7l9-11h-7z',
  '♻':  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  '📦': 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  '🌱': 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  '👥': 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  '🗺': 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  '👤': 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
};

/* ─── Page title map ───────────────────────────────────── */
const PAGE_TITLES = {
  '/':                'Dashboard',
  '/chatbot':         'Design Assistant',
  '/documents':       'Document Intelligence',
  '/validator':       'Rule Validator',
  '/specifications':  'Specification Generator',
  '/visualizer':      '3D Design Viewer',
  '/compliance':      'Compliance & Audit',
  '/users':           'User Management',
  '/settings':        'Settings & AI Config',
};

const ROLE_DISPLAY = { admin: 'Administrator', user: 'Design Engineer' };

export default function Layout({ children, user, onLogout, theme = 'dark', onThemeToggle }) {
  const userRole = user?.role || 'user';
  const navigate  = useNavigate();
  const location  = useLocation();
  const { alerts, advisories } = useData();
  const [showAlerts,   setShowAlerts]   = useState(false);
  const [showAdvisory, setShowAdvisory] = useState(false);
  const [showProfile,  setShowProfile]  = useState(false);
  const [time,         setTime]         = useState(new Date());
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [showSearch,   setShowSearch]   = useState(false);
  const profileRef   = React.useRef(null);
  const searchRef    = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearch(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!showSearch) return undefined;
    const onDocClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSearch]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const visibleIndex = SEARCH_INDEX.filter(item => !item.roles || item.roles.includes(userRole));
    const scored = visibleIndex.map(item => {
      const haystack = [
        item.label,
        ...(item.breadcrumb || []),
        item.keywords || '',
      ].join(' ').toLowerCase();
      const matchCount = words.filter(w => haystack.includes(w)).length;
      return { item, matchCount };
    }).filter(({ matchCount }) => matchCount > 0);
    scored.sort((a, b) => {
      // Prioritise full-word matches in label, then match count
      const aLabel = a.item.label.toLowerCase().includes(q) ? 1 : 0;
      const bLabel = b.item.label.toLowerCase().includes(q) ? 1 : 0;
      if (bLabel !== aLabel) return bLabel - aLabel;
      return b.matchCount - a.matchCount;
    });
    return scored.slice(0, 10).map(({ item }) => item);
  }, [searchQuery]);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!showProfile) return undefined;
    const onDocClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setShowProfile(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showProfile]);

  const unacknowledgedAlerts = alerts?.filter(a => !a.acknowledged)?.length || 0;
  const criticalAlerts       = alerts?.filter(a => a.type === 'critical' && !a.acknowledged)?.length || 0;
  const pageTitle            = PAGE_TITLES[location.pathname] || 'Dashboard';

  return (
    <div className={`theme-${theme} h-screen w-screen flex overflow-hidden bg-app-darker`}>

      {/* ── SIDEBAR ──────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 overflow-hidden transition-all duration-200 bg-app-dark border-r border-app-border"
        style={{ width: sidebarOpen ? 'var(--app-sidebar-w, 244px)' : '60px' }}
      >
        {/* Logo row */}
        <div
          className="flex items-center gap-3 px-4 cursor-pointer shrink-0 border-b border-app-border"
          style={{ height: 'var(--app-header-h, 62px)' }}
          onClick={() => navigate('/')}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 60%,#8b5cf6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(99,102,241,0.35)',
          }}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17h18M5 17V9l7-5 7 5v8M9 17v-5h6v5" />
            </svg>
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="text-[13px] font-extrabold leading-tight tracking-tight" style={{ color: 'var(--app-text)' }}>HSL Design Validator</div>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--app-text-faint)' }}>AI · Offline · Secure</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          {NAV_SECTIONS.map((section) => {
            const visible = section.items.filter(item => !item.roles || item.roles.includes(userRole));
            if (!visible.length) return null;
            return (
              <div key={section.label}>
                {sidebarOpen && (
                  <p className="nav-section-label">{section.label}</p>
                )}
                {!sidebarOpen && <div className="h-3" />}
                {visible.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <div key={item.path} className="px-2">
                      <button
                        onClick={() => navigate(item.path)}
                        className={`nav-item w-full ${isActive ? 'active' : ''}`}
                        title={!sidebarOpen ? item.label : undefined}
                      >
                        <SvgIcon d={item.icon} />
                        {sidebarOpen && <span className="truncate">{item.label}</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Bottom: user + logout */}
        <div className="shrink-0 border-t border-app-border">
          {sidebarOpen ? (
            <div className="px-3 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ background: userRole === 'admin'
                    ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
                    : 'linear-gradient(135deg,#0ea5e9,#38bdf8)' }}
                >
                  {user?.fullName?.charAt(0) || 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--app-text)' }}>{user?.fullName}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider"
                    style={{ color: userRole === 'admin' ? '#a78bfa' : '#38bdf8' }}>
                    {ROLE_DISPLAY[userRole] || userRole}
                  </div>
                </div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
                </button>
              )}
            </div>
          ) : (
            <div className="px-2 py-3 flex flex-col items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: userRole === 'admin' ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'linear-gradient(135deg,#0ea5e9,#38bdf8)' }}>
                {user?.fullName?.charAt(0) || 'U'}
              </div>
              {onLogout && (
                <button onClick={onLogout} className="icon-btn" title="Sign Out">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── TOPBAR ──────────────────────────────────────────── */}
        <header
          className="shrink-0 flex items-center gap-3 px-4 border-b border-app-border"
          style={{ height: 'var(--app-header-h, 62px)', background: 'var(--app-chrome-bg)' }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="icon-btn"
            title="Toggle sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* App Command Center title */}
          <div className="hidden sm:flex flex-col ml-1">
            <span className="text-[11px] font-bold tracking-widest" style={{ color: 'var(--app-text)', letterSpacing: '0.10em' }}>HSL DESIGN VALIDATOR</span>
            <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{pageTitle} · Air-gapped Intranet</span>
          </div>

          {/* Search */}
          <div className="header-search flex-1 max-w-xs ml-3" ref={searchRef} style={{ position: 'relative' }}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--app-text-faint)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search anything… (Ctrl+K)"
              aria-label="Search"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); }}
              onFocus={() => setShowSearch(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); e.target.blur(); }
                if (e.key === 'Enter' && searchResults.length > 0) {
                  navigate(searchResults[0].path);
                  setShowSearch(false);
                  setSearchQuery('');
                  e.target.blur();
                }
              }}
            />
            {showSearch && searchQuery.trim() && (
              <div className="search-dropdown">
                {searchResults.length === 0 ? (
                  <div className="search-dropdown-empty">No results for "{searchQuery}"</div>
                ) : searchResults.map((item, idx) => (
                  <button
                    key={idx}
                    className="search-dropdown-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigate(item.path);
                      setShowSearch(false);
                      setSearchQuery('');
                    }}
                  >
                    <div className="sdi-icon"><SvgIcon d={SEARCH_ICON_PATHS[item.icon] || item.icon} size="w-3.5 h-3.5" /></div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="sdi-label">{item.label}</div>
                      <div className="sdi-desc">
                        {item.breadcrumb.join(' › ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* AI status chip */}
          <button
            onClick={() => navigate('/settings')}
            title="AI Settings"
            className={`hidden sm:flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors ${
              isConfigured()
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isConfigured() ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {isConfigured() ? 'AI Ready' : 'AI: Setup'}
          </button>

          {/* Live time */}
          <div className="hidden md:block font-mono text-xs px-2 py-1 rounded-md"
            style={{ background: 'var(--app-surface-soft)', color: 'var(--app-text-muted)', border: '1px solid var(--app-border)', letterSpacing: '0.04em' }}>
            {time.toLocaleTimeString('en-LK', { hour12: false })}
          </div>

          {/* Theme toggle */}
          <button
            onClick={onThemeToggle}
            className="icon-btn"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0L16.95 7.05M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="-1 -1 26 26">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1012 21a8.962 8.962 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* AI Advisory — wider purple action button */}
          <button
            onClick={() => { setShowAdvisory(!showAdvisory); setShowAlerts(false); }}
            className={`app-advisory-btn ${showAdvisory ? 'active' : ''}`}
            title="AI Advisory"
            aria-label="AI Advisory"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>AI Advisory</span>
          </button>

          {/* Alerts bell */}
          <button
            onClick={() => { setShowAlerts(!showAlerts); setShowAdvisory(false); }}
            className={`icon-btn ${showAlerts ? 'active' : ''}`}
            title="Alerts"
            aria-label="Alerts"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unacknowledgedAlerts > 0 && (
              <span
                className={`absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] flex items-center justify-center font-bold px-0.5 ${criticalAlerts > 0 ? 'animate-pulse' : ''}`}
                style={{
                  background: criticalAlerts > 0 ? 'var(--app-danger)' : 'var(--app-warning)',
                  color: 'var(--app-on-color)',
                }}
              >
                {unacknowledgedAlerts}
              </span>
            )}
          </button>

          {/* User avatar — icon only with dropdown menu */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setShowProfile((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={showProfile}
              title={user?.fullName || 'Account'}
            >
              {user?.fullName?.charAt(0) || 'U'}
            </button>
            {showProfile && (
              <div className="profile-menu" role="menu">
                <div className="profile-menu-header">
                  <div className="avatar"
                    style={{ background: userRole === 'admin'
                      ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
                      : 'linear-gradient(135deg,#0ea5e9,#38bdf8)' }}>
                    {user?.fullName?.charAt(0) || 'U'}
                  </div>
                  <div className="min-w-0">
                    <div className="name truncate">{user?.fullName || 'Account'}</div>
                    <div className="status" style={{ color: userRole === 'admin' ? '#a78bfa' : '#38bdf8' }}>
                      {ROLE_DISPLAY[userRole] || userRole}
                    </div>
                  </div>
                </div>
                <div className="profile-menu-section">
                  <button className="profile-menu-item" role="menuitem" onClick={() => { setShowProfile(false); setShowAlerts(true); setShowAdvisory(false); }}>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
                    Notifications
                  </button>
                  <button className="profile-menu-item" role="menuitem" onClick={() => { setShowProfile(false); onThemeToggle && onThemeToggle(); }}>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    Toggle Theme
                  </button>
                  {userRole === 'admin' && (
                    <button className="profile-menu-item" role="menuitem" onClick={() => { setShowProfile(false); navigate('/users'); }}>
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                      User Management
                    </button>
                  )}
                </div>
                <div className="profile-menu-section">
                  {onLogout && (
                    <button className="profile-menu-item" role="menuitem"
                      style={{ color: '#f87171' }}
                      onClick={() => { setShowProfile(false); onLogout(); }}>
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                      Sign Out
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── CONTENT ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden">
          <main className={`h-full ${location.pathname === '/map' ? 'overflow-y-auto' : 'overflow-auto p-4'}`}>
            {children}
          </main>
        </div>
      </div>

      {/* Alert panel — rendered outside flex flow, true fixed overlay */}
      {showAlerts && (
        <div className="w-80 overflow-hidden animate-slide-up border-l border-app-border bg-app-darker"
          style={{ position: 'fixed', top: 'var(--app-header-h, 62px)', right: 0, bottom: 0, zIndex: 200 }}>
          <AlertPanel alerts={alerts} onClose={() => setShowAlerts(false)} />
        </div>
      )}

      {/* AI Advisory panel — rendered outside flex flow, true fixed overlay */}
      {showAdvisory && (
        <div className="app-advisory-panel w-96 overflow-hidden animate-slide-up border-2 border-app-border"
          style={{ position: 'fixed', top: 'var(--app-header-h, 62px)', right: 0, bottom: 0, zIndex: 200 }}>
          <AdvisoryPanel advisories={advisories} onClose={() => setShowAdvisory(false)} />
        </div>
      )}
    </div>
  );
}

