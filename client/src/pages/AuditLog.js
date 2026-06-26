import React, { useState, useEffect, useCallback } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, Field, Spinner } from '../components/feature/FeatureKit';
import { getAuditLogs, getAuditStats } from '../services/featureApi';

const COLUMNS = ['Date & Time', 'User', 'Role', 'Module', 'Action', 'Detail', 'Status', 'IP'];

function fmtTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('en-GB', { hour12: false }); } catch (_) { return ts; }
}

export default function AuditLog() {
  const [filters, setFilters] = useState({ user: '', module: '', action: '', status: '', from: '', to: '', q: '' });
  const [logs, setLogs]   = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (v) => setFilters(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [res, st] = await Promise.all([getAuditLogs({ ...filters, limit: 1000 }), getAuditStats()]);
      setLogs(res.logs || []);
      setTotal(res.total || 0);
      setStats(st);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }, [filters]);

  useEffect(() => { load(); /* initial */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = logs.map(l => ({
    'Date & Time': fmtTs(l.ts),
    'User': l.user,
    'Role': l.role || '',
    'Module': l.module,
    'Action': l.action,
    'Detail': l.detail || '',
    'Status': l.status,
    'IP': (l.ip || '').replace(/^::ffff:/, ''),
  }));

  const topModules = stats ? Object.entries(stats.byModule || {}).sort((a, b) => b[1] - a[1]).slice(0, 1)[0] : null;

  return (
    <Page
      title="Audit Log Management"
      subtitle="A comprehensive, append-only trail of key user activities — logins/logouts, document uploads & downloads, AI queries and prompts, record updates and administrative actions. Filterable and exportable to Excel, Word or PDF."
    >
      <Card title="Filters" desc="Narrow the trail by user, module, action, status, date range or free text.">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="User" value={filters.user} onChange={set('user')} placeholder="e.g. admin" />
          <Field label="Module" value={filters.module} onChange={set('module')} placeholder="e.g. Inspection" />
          <Field label="Action" value={filters.action} onChange={set('action')} placeholder="e.g. Login, Upload" />
          <Field label="Status (HTTP)" value={filters.status} onChange={set('status')} placeholder="e.g. 200, 401" />
          <Field label="From (YYYY-MM-DD)" value={filters.from} onChange={set('from')} placeholder="2026-06-01" />
          <Field label="To (YYYY-MM-DD)" value={filters.to} onChange={set('to')} placeholder="2026-06-30" />
        </div>
        <Field label="Free-text search" value={filters.q} onChange={set('q')} placeholder="Search across user, module, action, detail, path…" />
        <RunButton onClick={load} busy={busy} busyLabel="Loading audit trail…">Apply filters / Refresh</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Total events" value={stats.total} tone="sky" />
          <StatTile label="Showing" value={total} tone="violet" />
          <StatTile label="Distinct users" value={Object.keys(stats.byUser || {}).length} tone="emerald" />
          <StatTile label="Busiest module" value={topModules ? topModules[0].split(' ')[0] : '—'} tone="amber" />
        </div>
      )}

      <Card title="Activity Trail" desc={`${total} matching event${total === 1 ? '' : 's'}${total > rows.length ? ` · showing latest ${rows.length}` : ''}.`}>
        {busy && !rows.length ? (
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Spinner /> Loading…</div>
        ) : rows.length ? (
          <ResultTable columns={COLUMNS} rows={rows} title="Audit Log" sheetName="Audit Log" downloadName="Audit_Log" />
        ) : (
          <div className="text-[11px] text-slate-500">No audit events match the current filters yet. Activity is recorded automatically as users work in the application.</div>
        )}
      </Card>
    </Page>
  );
}
