// ─────────────────────────────────────────────────────────────────────────────
// HSL Design Validator — AI Service
// Calls the local Express backend (proxied via React dev server).
// The Gemini API key is configured server-side via server/.env
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api';

// Always true — API key is configured server-side via server/.env
export function isConfigured() { return true; }

// ── Auth token helper ─────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('auth_token') || '';
}

// ── Internal fetch helper ─────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.dispatchEvent(new Event('auth:logout'));
    throw new Error('Session expired — please sign in again');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── API methods ───────────────────────────────────────────────────────────────

export async function chat(messages, domain) {
  return post('/chat', { messages, domain });
}

export async function validate(specId, domain, additionalContext) {
  return post('/validate', { specId, domain, additionalContext });
}

export async function compareByIds(docAId, docBId, docAName, docBName) {
  return post('/compare', { docAId, docBId, docAName, docBName });
}

export async function compareByText(docAText, docBText, docAName, docBName) {
  return post('/compare', { docAText, docBText, docAName, docBName });
}

export async function uploadDocument(file, docType, docName) {
  const form = new FormData();
  form.append('file',    file);
  form.append('docType', docType  || '');
  form.append('docName', docName  || file.name);
  return apiFetch('/upload', { method: 'POST', body: form });
}

export async function getKbStatus() {
  return apiFetch('/kb-status');
}

export async function listDocuments() {
  return apiFetch('/documents');
}

export async function testConnection() {
  return apiFetch('/health');
}

// ── User management (admin only) ──────────────────────────────────────────────

export async function getUsers() {
  return apiFetch('/auth/users');
}

export async function createUser(data) {
  return apiFetch('/auth/users', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
}

export async function updateUser(id, data) {
  return apiFetch(`/auth/users/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
}

export async function deleteUser(id) {
  return apiFetch(`/auth/users/${id}`, { method: 'DELETE' });
}
