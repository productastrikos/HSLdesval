'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// User Interaction History  (HSL MVP item 14)
//
// Maintains a per-user, cross-module history of searches, queries/prompts and the
// AI-generated responses, so users can revisit, search/filter and continue prior
// interactions. Persisted to server/data/interactions.json (newest first, capped).
//
//   record(req, { module, prompt, response, subject })  — server-side recorder,
//                 called by the chat + generation endpoints.
//   router:
//     POST   /api/interactions          — client-side recorder (generation pages)
//     GET    /api/interactions          — the caller's own history (+ filters);
//                                         admins may pass ?all=1 to see everyone's
//     GET    /api/interactions/:id      — full record (to revisit / continue)
//     DELETE /api/interactions/:id      — remove own record (admins: any)
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const store   = require('../lib/store');

const router     = express.Router();
const COLLECTION = 'interactions';
const MAX        = 8000;
const RESP_CAP   = 12000;   // keep enough of the response to revisit, bound storage

function record(req, { module = 'Application', prompt = '', response = '', subject = '' } = {}) {
  try {
    const user = req.user?.username || 'anonymous';
    const all  = store.readAll(COLLECTION);
    const item = {
      id: `INT-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      ts: new Date().toISOString(),
      user,
      module: String(module).slice(0, 80),
      prompt: String(prompt || '').slice(0, 4000),
      response: String(response || '').slice(0, RESP_CAP),
      subject: String(subject || '').slice(0, 300),
    };
    all.unshift(item);
    if (all.length > MAX) all.length = MAX;
    store.writeAll(COLLECTION, all);
    return item;
  } catch (_) { return null; }
}

// ── POST /api/interactions ────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { module, prompt, response, subject } = req.body || {};
  const item = record(req, { module, prompt, response, subject });
  if (!item) return res.status(500).json({ error: 'Could not record interaction.' });
  res.status(201).json({ ok: true, id: item.id });
});

// ── GET /api/interactions ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { module = '', q = '', from = '', to = '', all = '', limit = '500' } = req.query;
  const isAdmin = req.user?.role === 'admin';
  const me = req.user?.username;
  let items = store.readAll(COLLECTION);
  // A user only sees their own history; an admin may opt into everyone's.
  if (!(isAdmin && (all === '1' || all === 'true'))) items = items.filter(i => i.user === me);
  const lc = s => String(s).toLowerCase();
  if (module) items = items.filter(i => lc(i.module).includes(lc(module)));
  if (from)   items = items.filter(i => i.ts >= from);
  if (to)     items = items.filter(i => i.ts <= to);
  if (q)      items = items.filter(i => lc(`${i.module} ${i.prompt} ${i.response} ${i.subject}`).includes(lc(q)));
  const total = items.length;
  const n = Math.min(parseInt(limit, 10) || 500, 3000);
  // List view trims the response for payload size; full text via GET /:id.
  const list = items.slice(0, n).map(i => ({ ...i, response: i.response.slice(0, 600) }));
  res.json({ total, returned: list.length, interactions: list });
});

// ── GET /api/interactions/:id  (full record, for revisit / continue) ──────────
router.get('/:id', (req, res) => {
  const item = store.readAll(COLLECTION).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Interaction not found.' });
  if (item.user !== req.user?.username && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'You can only view your own interactions.' });
  }
  res.json({ interaction: item });
});

// ── DELETE /api/interactions/:id ──────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const all = store.readAll(COLLECTION);
  const item = all.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Interaction not found.' });
  if (item.user !== req.user?.username && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'You can only delete your own interactions.' });
  }
  store.writeAll(COLLECTION, all.filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

module.exports = { router, record };
