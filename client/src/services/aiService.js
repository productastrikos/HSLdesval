// ─────────────────────────────────────────────────────────────────────────────
// HSL Design Validator — Inference Service
// Calls the local on-premise backend (proxied via the dev server in development).
// All inference runs locally on the appliance; nothing leaves the network.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api';

// The on-premise inference engine is always available server-side.
export function isConfigured() { return true; }

// ── Auth token helper ─────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('auth_token') || '';
}

// ── Internal fetch helper ─────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = getToken();

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (_) {
    // Network failure / server unreachable / CORS — fetch rejects with TypeError.
    throw new Error('Cannot reach the server. Please check your connection and that the application is running.');
  }

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.dispatchEvent(new Event('auth:logout'));
    throw new Error('Session expired — please sign in again.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
    throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  }
  return res.json().catch(() => ({}));
}

async function post(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── API methods ───────────────────────────────────────────────────────────────

export async function chat(messages, domain, chatDocText, chatDocName) {
  return post('/chat', { messages, domain, chatDocText, chatDocName });
}

export async function extractChatDoc(file) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch('/chat-extract', { method: 'POST', body: form });
}

export async function validate({ specId, specText, specName, domain, additionalContext }) {
  return post('/validate', { specId, specText, specName, domain, additionalContext });
}

export async function compareByIds(docAId, docBId, docAName, docBName) {
  return post('/compare', { docAId, docBId, docAName, docBName });
}

export async function compareByText(docAText, docBText, docAName, docBName) {
  return post('/compare', { docAText, docBText, docAName, docBName });
}

// Upload a document: the backend extracts text (vision OCR for image-only pages)
// and auto-classifies the document type. The extracted text is returned to the
// caller, which persists it in the browser document store.
export async function uploadDocument(file, docName) {
  const form = new FormData();
  form.append('file',    file);
  form.append('docName', docName || file.name);
  return apiFetch('/upload', { method: 'POST', body: form });
}

// Parsed text of the built-in knowledge-base documents (for local caching only).
export async function getBaseKnowledge() {
  return apiFetch('/base-knowledge');
}

export async function getKbStatus() {
  return apiFetch('/kb-status');
}

export async function listDocuments() {
  return apiFetch('/documents');
}

export async function deleteDocument(id) {
  return apiFetch(`/documents/${id}`, { method: 'DELETE' });
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
