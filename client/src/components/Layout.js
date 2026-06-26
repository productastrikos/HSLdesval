import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

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
      { path: '/history',        roles: ['admin','user'], icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Interaction History' },
    ],
  },
  {
    label: 'Document Intelligence',
    items: [
      { path: '/documents',      roles: ['admin','user'], icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Document Intel' },
      { path: '/workspace',      roles: ['admin','user'], icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', label: 'Workspace' },
      { path: '/converter',      roles: ['admin','user'], icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4', label: 'Document Converter' },
      { path: '/doc-worker',     roles: ['admin','user'], icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', label: 'Document Worker' },
      { path: '/drawings',       roles: ['admin','user'], icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 9h16M9 4v16', label: 'Drawing Intelligence' },
      { path: '/inspection',     roles: ['admin','user'], icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: 'Inspection Analytics' },
      { path: '/lessons',        roles: ['admin','user'], icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', label: 'Lessons Learned' },
    ],
  },
  {
    label: 'Procurement & Generation',
    items: [
      { path: '/compliance',     roles: ['admin','user'], icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', label: 'Offer Scrutiny' },
      { path: '/binding',        roles: ['admin','user'], icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', label: 'Binding Data Review' },
      { path: '/prebid',         roles: ['admin','user'], icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Pre-Bid Queries' },
      { path: '/bom',            roles: ['admin','user'], icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', label: 'BOM & SOTR' },
      { path: '/cost',           roles: ['admin','user'], icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Ship Cost Estimation' },
      { path: '/design-review',  roles: ['admin','user'], icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2zM12 9v3', label: 'Design Review' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { path: '/users',          roles: ['admin'],        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', label: 'User Management' },
      { path: '/audit',          roles: ['admin'],        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2zM12 11h.01', label: 'Audit Log' },
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
  { label:'Interaction History',   path:'/history',         breadcrumb:['AI Assistant','History'],               icon:'📋', keywords:'user interaction history previous prompts queries ai responses revisit continue reuse search filter module date export', roles:['admin','user'] },
  { label:'Document Intelligence', path:'/documents',       breadcrumb:['Document Intelligence','Document Intel'], icon:'📋', keywords:'document intel ocr scanned pdf extraction parse manual equipment text searchable convert word excel odf compare validate', roles:['admin','user'] },
  { label:'Workspace',             path:'/workspace',        breadcrumb:['Document Intelligence','Workspace'],     icon:'📦', keywords:'workspace management hierarchical project wise repository discipline folder organise upload retrieve search move documents tree', roles:['admin','user'] },
  { label:'Document Converter',    path:'/converter',       breadcrumb:['Document Intelligence','Converter'],     icon:'📋', keywords:'intelligent document converter extract custom columns prompt excel word convert information extraction table format', roles:['admin','user'] },
  { label:'Document Worker',       path:'/doc-worker',      breadcrumb:['Document Intelligence','Worker'],        icon:'📋', keywords:'intelligent document worker edit modify rewrite restructure summarise translate reformat change document word', roles:['admin','user'] },
  { label:'Drawing Intelligence',  path:'/drawings',        breadcrumb:['Document Intelligence','Drawings'],      icon:'📋', keywords:'drawing intelligence extraction cable schedule sld single line diagram general arrangement ga dwg dxf autocad equipment tag legend bom compartment area irs validation ship specifications excel mbsre vision', roles:['admin','user'] },
  { label:'Inspection Reports Analytics', path:'/inspection', breadcrumb:['Document Intelligence','Inspection'],  icon:'📋', keywords:'inspection reports analytics dashboard equipment wise observation non conformity ncr remark classify status open closed handwritten image ocr sat unsat excel', roles:['admin','user'] },
  { label:'Lessons Learned',       path:'/lessons',         breadcrumb:['Document Intelligence','Lessons'],       icon:'📋', keywords:'lessons learned repository search recurring issues design considerations proactive knowledge defects history', roles:['admin','user'] },
  { label:'Technical Offer Scrutiny', path:'/compliance',   breadcrumb:['Procurement & Generation','Offer Scrutiny'], icon:'📋', keywords:'technical offer scrutiny compliance matrix tts sotr tender specification deviation exclusion assumption ambiguity vendor query evaluation multiple offers recommendation seek document', roles:['admin','user'] },
  { label:'Binding Data Review',   path:'/binding',         breadcrumb:['Procurement & Generation','Binding Data'],   icon:'📦', keywords:'vendor binding data review pots purchase order technical specification gap analysis drawings calculations certificates manuals test procedures missing', roles:['admin','user'] },
  { label:'Pre-Bid Queries',       path:'/prebid',          breadcrumb:['Procurement & Generation','Pre-Bid'],        icon:'📋', keywords:'pre bid query generation rfp tender ambiguity contradiction missing information impractical requirement execution risk clarification page number clause description build specification tugs', roles:['admin','user'] },
  { label:'BOM & SOTR Generator',  path:'/bom',             breadcrumb:['Procurement & Generation','BOM & SOTR'],     icon:'📋', keywords:'bom bill of materials generation rfp build specification equipment name oem capacity page number reference estimation calculation sotr statement of technical requirements', roles:['admin','user'] },
  { label:'Ship Cost Estimation',  path:'/cost',            breadcrumb:['Procurement & Generation','Ship Cost'],      icon:'📋', keywords:'ship cost estimation assistant bom unit rate approved vendor database budgetary quotation bq enquiry email discipline system wise cost summary traceability', roles:['admin','user'] },
  { label:'Design Review',         path:'/design-review',   breadcrumb:['Procurement & Generation','Design Review'],  icon:'📋', keywords:'design review risk assessment checklist system wise recurring deficiency preventive measure rules historical', roles:['admin','user'] },
  { label:'User Management',       path:'/users',           breadcrumb:['Administration','Users'],               icon:'👥', keywords:'users accounts roles admin engineer access management permissions department rbac', roles:['admin'] },
  { label:'Audit Log',             path:'/audit',           breadcrumb:['Administration','Audit Log'],           icon:'📋', keywords:'audit log trail activity login logout upload download query prompt status change history security traceability export', roles:['admin'] },
  { label:'Settings',              path:'/settings',        breadcrumb:['System','Settings'],                    icon:'⚙', keywords:'settings configuration knowledge base kb rag backend server connection', roles:['admin'] },
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
  '/history':         'User Interaction History',
  '/documents':       'Document Intelligence',
  '/workspace':       'Workspace Management',
  '/converter':       'Intelligent Document Converter',
  '/doc-worker':      'Intelligent Document Worker',
  '/drawings':        'Drawing Intelligence',
  '/inspection':      'Inspection Reports Analytics',
  '/bom':             'BOM & SOTR Generator',
  '/cost':            'Ship Cost Estimation Assistant',
  '/lessons':         'Lessons-Learned Repository',
  '/compliance':      'Technical Offer Scrutiny',
  '/binding':         'Vendor Binding Data Review',
  '/prebid':          'Pre-Bid Query Generation',
  '/design-review':   'Design Review & Risk Assessment',
  '/users':           'User Management',
  '/audit':           'Audit Log Management',
  '/settings':        'Settings',
};

const ROLE_DISPLAY = { admin: 'Administrator', user: 'Design Engineer' };

export default function Layout({ children, user, onLogout, theme = 'dark', onThemeToggle }) {
  const userRole = user?.role || 'user';
  const navigate  = useNavigate();
  const location  = useLocation();
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
  }, [searchQuery, userRole]);

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

  const pageTitle            = PAGE_TITLES[location.pathname] || 'Dashboard';

  return (
    <div className={`theme-${theme} h-screen w-screen flex overflow-hidden bg-app-darker`}>

      {/* ── SIDEBAR ──────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 overflow-hidden transition-all duration-200 bg-app-dark border-r border-app-border"
        style={{ width: sidebarOpen ? 'var(--app-sidebar-w, 244px)' : '60px' }}
      >
        {/* Logo row — Astrikos brand mark + product name */}
        <div
          className={`flex items-center cursor-pointer shrink-0 border-b border-app-border ${sidebarOpen ? 'gap-2.5 px-4' : 'justify-center px-2'}`}
          style={{ height: 'var(--app-header-h, 62px)' }}
          onClick={() => navigate('/')}
          title="HSL Design Validator — by Astrikos"
        >
          <img
            src="/astrikos-logo.png"
            alt="Astrikos"
            style={{ height: sidebarOpen ? 30 : 20, width: 'auto', maxWidth: sidebarOpen ? 76 : 40, objectFit: 'contain', flexShrink: 0 }}
          />
          {sidebarOpen && (
            <div className="min-w-0 pl-2.5 border-l" style={{ borderColor: 'var(--app-border)' }}>
              <div className="text-[12px] font-extrabold leading-tight tracking-tight" style={{ color: 'var(--app-text)' }}>HSL Design Validator</div>
              <div className="text-[8px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--app-text-faint)' }}>by Astrikos · Secure</div>
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

    </div>
  );
}

