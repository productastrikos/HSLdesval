'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log Management  (HSL MVP item 13)
//
// Maintains a comprehensive, tamper-resistant-by-append audit trail of key user
// activities: logins/logouts, document uploads/downloads, AI searches & prompts,
// record updates (inspection status, feedback) and admin user-management actions.
//
//   auditMiddleware  — global; records every meaningful mutation automatically by
//                      hooking res 'finish' (so req.user, set by authenticate, is
//                      populated and the real HTTP status is known).
//   logEvent({...})  — explicit logger for events with no obvious request body
//                      (login success/failure, logout).
//   router           — GET /api/audit (admin) with filters; GET /api/audit/stats.
//
// Persisted to server/data/audit.json (newest first, capped at MAX entries).
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const store   = require('../lib/store');

const router     = express.Router();
const COLLECTION = 'audit';
const MAX        = 20000;

// Path prefix → friendly module name (longest match wins).
const MODULES = [
  ['/api/auth/users',                'User Management'],
  ['/api/auth/login',                'Authentication'],
  ['/api/auth/logout',               'Authentication'],
  ['/api/chat',                      'Rules & Regulations Assistant'],
  ['/api/validate',                  'Design Validation'],
  ['/api/compare',                   'Document Comparison'],
  ['/api/upload',                    'Documents'],
  ['/api/convert',                   'Documents'],
  ['/api/extract-text',              'Documents'],
  ['/api/chat-extract',              'Documents'],
  ['/api/documents',                 'Documents'],
  ['/api/export',                    'Export'],
  ['/api/drawings',                  'Engineering Drawing Intelligence'],
  ['/api/inspection',                'Inspection Report Analytics'],
  ['/api/lessons',                   'Lessons Learnt Repository'],
  ['/api/compliance',                'Technical Offer Evaluation'],
  ['/api/binding',                   'Binding Data Gap Analysis'],
  ['/api/prebid',                    'Pre-Bid Query Generation'],
  ['/api/designreview',              'Design Review Assistant'],
  ['/api/docworker',                 'Document Converter / Worker'],
  ['/api/bom',                       'BOM & SOTR Generation'],
  ['/api/cost',                      'Ship Cost Estimation'],
  ['/api/dashboard',                 'Dashboard Analytics'],
  ['/api/feedback',                  'User Feedback'],
  ['/api/workspace',                 'Workspace Management'],
];

function moduleFor(path) {
  let best = 'Application', bestLen = 0;
  for (const [prefix, name] of MODULES) {
    if (path.startsWith(prefix) && prefix.length > bestLen) { best = name; bestLen = prefix.length; }
  }
  return best;
}

function trunc(v, n = 180) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Derive a human action label + short detail from the request.
// `p` is captured at middleware entry (req.url can be mutated by sub-routers).
function describe(req, rawPath) {
  const p = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;  // tolerate trailing slash
  const m = req.method, b = req.body || {};
  if (p === '/api/auth/users' && m === 'POST')   return ['Create user account', trunc(b.username)];
  if (/^\/api\/auth\/users\//.test(p) && m === 'PUT')    return ['Update user account', trunc(b.username || p.split('/').pop())];
  if (/^\/api\/auth\/users\//.test(p) && m === 'DELETE') return ['Delete user account', trunc(p.split('/').pop())];
  if (p === '/api/chat')          return ['AI query / prompt', trunc((Array.isArray(b.messages) ? b.messages.filter(x => x.role === 'user').slice(-1)[0]?.content : b.message) || '')];
  if (p === '/api/feedback')      return ['Submit feedback', trunc(`${b.rating || ''}${b.subject ? ` · ${b.subject}` : ''}`)];
  if (p === '/api/upload')        return ['Upload document', trunc(req.file?.originalname)];
  if (p === '/api/convert')       return ['Convert / download document', trunc(`${req.file?.originalname || ''} → ${b.format || ''}`)];
  if (p === '/api/extract-text')  return ['Extract document text', trunc(req.file?.originalname)];
  if (p.startsWith('/api/export/')) return [`Download (${p.split('/').pop().toUpperCase()})`, trunc(b.filename || b.title)];
  if (/^\/api\/inspection\/observations\//.test(p) && m === 'PATCH') return ['Update observation status', trunc(`status → ${b.status || ''}`)];
  if (p.startsWith('/api/inspection') && m === 'POST') return ['Analyse inspection report', trunc(b.project || req.file?.originalname || '')];
  if (p.startsWith('/api/drawings')) return [p.endsWith('validate') ? 'Validate drawing' : 'Extract from drawing', trunc(b.prompt || req.file?.originalname || '')];
  if (p.startsWith('/api/lessons') && m === 'DELETE') return ['Delete lesson', trunc(p.split('/').pop())];
  if (p.startsWith('/api/lessons') && m === 'POST')   return ['Add / query lessons', trunc(b.q || b.observation || '')];
  if (/^\/api\/documents\//.test(p) && m === 'DELETE') return ['Delete document', trunc(p.split('/').pop())];
  // generic fallback
  const label = { POST: 'Create / run', PUT: 'Update', PATCH: 'Update', DELETE: 'Delete' }[m] || m;
  return [`${label}`, trunc(b.prompt || b.title || '')];
}

function record(entry) {
  try {
    const all  = store.readAll(COLLECTION);
    const item = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      ts: new Date().toISOString(),
      ...entry,
    };
    all.unshift(item);
    if (all.length > MAX) all.length = MAX;
    store.writeAll(COLLECTION, all);
    return item;
  } catch (_) { return null; }
}

// Explicit logger (login/logout and any place that wants a precise record).
function logEvent({ user = 'anonymous', module = 'Application', action, detail = '', status = 200, ip = '' }) {
  return record({ user, module, action, detail, status, method: 'EVENT', path: '' });
}

// Global middleware — auto-records meaningful mutations.
function auditMiddleware(req, res, next) {
  // Capture the path now — sub-routers temporarily rewrite req.url during dispatch.
  const p = (req.originalUrl || req.url || '').split('?')[0];
  const skip =
    !p.startsWith('/api/') ||
    req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ||
    p.startsWith('/api/audit') ||
    p === '/api/auth/login' ||          // logged explicitly with username + outcome
    p === '/api/auth/logout';           // logged explicitly
  if (skip) return next();

  res.on('finish', () => {
    try {
      const [action, detail] = describe(req, p);
      record({
        user:   req.user?.username || 'anonymous',
        role:   req.user?.role || '',
        module: moduleFor(p),
        action,
        detail,
        method: req.method,
        path:   p,
        status: res.statusCode,
        ip:     req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      });
    } catch (_) { /* never let auditing break a request */ }
  });
  next();
}

// ── GET /api/audit  (admin only — applied at mount) ───────────────────────────
// Filters: user, module, action, status, from (ISO), to (ISO), q (free text), limit
router.get('/', (req, res) => {
  const { user = '', module = '', action = '', status = '', from = '', to = '', q = '', limit = '500' } = req.query;
  let items = store.readAll(COLLECTION);
  const lc = s => String(s).toLowerCase();
  if (user)   items = items.filter(i => lc(i.user).includes(lc(user)));
  if (module) items = items.filter(i => lc(i.module).includes(lc(module)));
  if (action) items = items.filter(i => lc(i.action).includes(lc(action)));
  if (status) items = items.filter(i => String(i.status) === String(status));
  if (from)   items = items.filter(i => i.ts >= from);
  if (to)     items = items.filter(i => i.ts <= to);
  if (q)      items = items.filter(i => lc(`${i.user} ${i.module} ${i.action} ${i.detail} ${i.path}`).includes(lc(q)));
  const total = items.length;
  const n = Math.min(parseInt(limit, 10) || 500, 5000);
  res.json({ total, returned: Math.min(total, n), logs: items.slice(0, n) });
});

// ── GET /api/audit/stats ──────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const items = store.readAll(COLLECTION);
  const byModule = {}, byUser = {};
  for (const i of items) {
    byModule[i.module] = (byModule[i.module] || 0) + 1;
    byUser[i.user]     = (byUser[i.user] || 0) + 1;
  }
  res.json({ total: items.length, byModule, byUser, latest: items[0]?.ts || null });
});

module.exports = { router, auditMiddleware, logEvent };
