import React, { useState, useEffect, useCallback } from 'react';
import { getUsers, createUser, updateUser, deleteUser } from '../services/aiService';

const ROLE_BADGE = {
  admin: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  user:  'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

// Department-wise access control (HSL MVP item 15).
const DEPARTMENTS = ['Administration', 'Electrical', 'Machinery', 'Hull', 'Outfit', 'Piping', 'HVAC', 'Production', 'QA', 'Planning', 'Submarine', 'Ship Repairs', 'General'];

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-sm rounded-2xl border p-5"
        style={{ background: 'var(--app-dark)', borderColor: 'var(--app-border)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button onClick={onClose} className="icon-btn">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function UserForm({ initial, onSave, onCancel, isCreate }) {
  const [form, setForm] = useState({
    username:   initial?.username   || '',
    fullName:   initial?.fullName   || '',
    password:   '',
    role:       initial?.role       || 'user',
    department: initial?.department  || 'General',
    active:     initial?.active === undefined ? true : !!initial.active,
  });
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (isCreate && !form.password) { setError('Password is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { fullName: form.fullName, role: form.role, department: form.department, active: form.active };
      if (isCreate) { payload.username = form.username; payload.password = form.password; }
      if (!isCreate && form.password) payload.password = form.password;
      await onSave(payload);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const inputCls = "w-full px-3 py-1.5 rounded-lg text-[12px] outline-none"
    + " bg-slate-950 border border-slate-700 text-slate-200";

  return (
    <form onSubmit={submit} className="space-y-3">
      {isCreate && (
        <div>
          <label className="block text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Username</label>
          <input className={inputCls} value={form.username} onChange={e => set('username', e.target.value)} required placeholder="login.name" />
        </div>
      )}
      <div>
        <label className="block text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Full Name</label>
        <input className={inputCls} value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="Full Name" />
      </div>
      <div>
        <label className="block text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">
          Password {!isCreate && <span className="text-slate-600">(leave blank to keep current)</span>}
        </label>
        <input className={inputCls} type="password" value={form.password} onChange={e => set('password', e.target.value)}
          placeholder={isCreate ? 'min 6 chars' : '••••••••'} minLength={isCreate ? 6 : undefined} />
      </div>
      <div>
        <label className="block text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Role</label>
        <div className="flex gap-2">
          {[['admin','Administrator'],['user','Design Engineer']].map(([val,lbl]) => (
            <button key={val} type="button"
              onClick={() => set('role', val)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                form.role === val
                  ? val === 'admin' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
              }`}
            >{lbl}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Department</label>
        <select className={inputCls} value={form.department} onChange={e => set('department', e.target.value)}>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="accent-emerald-500" />
        Account active (deactivated users cannot sign in)
      </label>
      {error && <p className="text-[11px] text-red-400">⚠ {error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-slate-700 text-slate-400 text-[11px] hover:bg-slate-800">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="flex-1 py-2 rounded-lg text-white text-[11px] font-semibold disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)' }}>
          {saving ? 'Saving…' : isCreate ? 'Create User' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}

export default function UserManagement() {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [modal,    setModal]    = useState(null); // null | 'create' | { user }
  const [deleting, setDeleting] = useState(null); // userId

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getUsers();
      setUsers(list);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async (payload) => {
    await createUser(payload);
    setModal(null);
    refresh();
  };

  const handleUpdate = async (id, payload) => {
    await updateUser(id, payload);
    setModal(null);
    refresh();
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await deleteUser(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
    setDeleting(null);
  };

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">User Management</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">Manage system accounts with role-based and department-based access · activate/deactivate · full audit trail</p>
        </div>
        <button
          onClick={() => setModal('create')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-[11px] font-semibold"
          style={{ background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Users',    value: users.length,                              color: 'text-sky-400' },
          { label: 'Administrators', value: users.filter(u => u.role==='admin').length, color: 'text-violet-400' },
          { label: 'Departments',    value: new Set(users.map(u => u.department || 'General')).size, color: 'text-amber-400' },
          { label: 'Inactive',       value: users.filter(u => u.active === false).length, color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-app-panel border border-app-border rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</div>
            <div className={`text-2xl font-bold ${color} mt-1`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border">
          <h3 className="text-sm font-bold text-white">System Accounts</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500 text-sm">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-red-400 text-sm">⚠ {error}</div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-2.5 font-bold">User</th>
                <th className="text-left px-4 py-2.5 font-bold">Role</th>
                <th className="text-left px-4 py-2.5 font-bold">Department</th>
                <th className="text-left px-4 py-2.5 font-bold">Status</th>
                <th className="text-left px-4 py-2.5 font-bold">Created</th>
                <th className="text-right px-4 py-2.5 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ background: u.role === 'admin'
                          ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
                          : 'linear-gradient(135deg,#0ea5e9,#38bdf8)' }}>
                        {u.fullName?.charAt(0) || u.username?.charAt(0) || 'U'}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-200">{u.fullName}</div>
                        <div className="text-slate-500 text-[10px] font-mono">@{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest ${ROLE_BADGE[u.role] || ''}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest bg-slate-700/30 text-slate-300 border-slate-600/40">{u.department || 'General'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {u.active === false
                      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest bg-red-500/15 text-red-300 border-red-500/30">Inactive</span>
                      : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Active</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleUpdate(u.id, { active: u.active === false })}
                        className={`text-[10px] px-2 py-1 rounded border ${u.active === false ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/25 hover:bg-amber-500/20'}`}
                      >
                        {u.active === false ? 'Activate' : 'Deactivate'}
                      </button>
                      <button
                        onClick={() => setModal({ user: u })}
                        className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={deleting === u.id}
                        className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {deleting === u.id ? '…' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[
          {
            role:  'Administrator',
            color: 'border-violet-500/30 bg-violet-500/[0.04]',
            badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
            perms: [
              'Upload compliance & guardrail documents (Class Rules, IACS, IMO, IEC, Naval, Build Spec)',
              'Upload vendor design documents',
              'View all documents with uploader information',
              'Compare any documents with AI diff',
              'Run compliance validation scans',
              'Generate technical specifications (AI)',
              'Manage user accounts and roles',
              'Access system settings and API configuration',
            ],
          },
          {
            role:  'Design Engineer',
            color: 'border-sky-500/30 bg-sky-500/[0.04]',
            badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
            perms: [
              'Upload vendor design documents (Tender, Design, OEM Manual, Vendor Spec)',
              'View all indexed documents for reference',
              'Compare vendor documents with AI diff',
              'Validate documents against compliance rules',
              'Query the AI design assistant',
            ],
          },
        ].map(r => (
          <div key={r.role} className={`rounded-xl border p-4 ${r.color}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest ${r.badge}`}>
                {r.role}
              </span>
              <span className="text-xs font-semibold text-white">{r.role} Permissions</span>
            </div>
            <ul className="space-y-1">
              {r.perms.map((p, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                  <svg className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {modal === 'create' && (
        <Modal title="Create New User" onClose={() => setModal(null)}>
          <UserForm isCreate onSave={handleCreate} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {/* Edit modal */}
      {modal?.user && (
        <Modal title={`Edit — ${modal.user.fullName}`} onClose={() => setModal(null)}>
          <UserForm
            initial={modal.user}
            onSave={(payload) => handleUpdate(modal.user.id, payload)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
