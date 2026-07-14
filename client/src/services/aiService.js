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

export async function chat(messages, domain, chatDocText, chatDocName, module) {
  return post('/chat', { messages, domain, chatDocText, chatDocName, module });
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

// Prompt-driven comparison of two documents → structured differences table.
export async function compareDocuments({ docAText, docBText, docAName, docBName, prompt }) {
  return post('/compare', { docAText, docBText, docAName, docBName, prompt });
}

// Compare 2+ documents of ANY type. `files` are File objects (PDF/DOCX/image/
// AutoCAD .dwg/.dxf — extracted server-side); `docs` are already-extracted
// { name, text } entries (e.g. selected library docs). Returns a matrix.
export async function compareMulti({ files = [], docs = [], prompt = '' }) {
  const form = new FormData();
  files.forEach(f => form.append('files', f, f.name));
  form.append('docs', JSON.stringify(docs));
  if (prompt) form.append('prompt', prompt);
  return apiFetch('/compare-multi', { method: 'POST', body: form });
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

// ── Persistent shared document repository ─────────────────────────────────────
// Unlike the per-session browser store (cleared on logout), the repository lives
// on the server: documents persist across sessions/restarts, are shared by all
// users, and have no count limit (and, with MAX_UPLOAD_MB=0, no size limit).

// Save an uploaded file to the shared repository. The server extracts text,
// auto-classifies it, and persists it. The extracted text is returned so the
// caller can also seed the in-session picker without re-uploading.
export async function saveToRepository(file, { project, discipline } = {}) {
  const form = new FormData();
  form.append('file', file);
  if (project)    form.append('project', project);
  if (discipline) form.append('discipline', discipline);
  return apiFetch('/repository', { method: 'POST', body: form });
}

// List repository metadata (optionally filtered by name/type/project).
export async function getRepository(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  return apiFetch(`/repository${qs ? `?${qs}` : ''}`);
}

// Fetch one repository document including its full extracted text.
export async function getRepositoryDoc(id) {
  return apiFetch(`/repository/${id}`);
}

export async function deleteRepositoryDoc(id) {
  return apiFetch(`/repository/${id}`, { method: 'DELETE' });
}

// ── Format conversion (single + batch) ────────────────────────────────────────
// Triggers a browser download. `format` ∈ TXT | XLSX | DOCX | ODF.
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function downloadConverted(path, form, fallbackName) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch (_) {
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
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const blob = await res.blob();
  triggerDownload(blob, match ? match[1] : fallbackName);
  return {
    kb:        Math.round(blob.size / 1024),
    converted: parseInt(res.headers.get('X-Converted-Count') || '0', 10) || undefined,
    failed:    parseInt(res.headers.get('X-Failed-Count') || '0', 10) || 0,
  };
}

// Convert a single file → downloads the converted file directly.
export async function convertFile(file, format = 'TXT') {
  const form = new FormData();
  form.append('file', file);
  form.append('format', format);
  const base = (file.name || 'document').replace(/\.[^/.]+$/, '');
  const ext  = format === 'XLSX' ? 'xlsx' : format === 'DOCX' ? 'docx' : format === 'ODF' ? 'odt' : 'txt';
  return downloadConverted('/convert', form, `${base}.${ext}`);
}

// Convert many files at once → downloads a single ZIP of the results.
export async function convertBatch(files, format = 'TXT') {
  const form = new FormData();
  files.forEach(f => form.append('files', f, f.name));
  form.append('format', format);
  const stamp = new Date().toISOString().slice(0, 10);
  return downloadConverted('/convert-batch', form, `converted_${format.toLowerCase()}_${stamp}.zip`);
}

// Parsed text of the built-in knowledge-base documents (for local caching only).
export async function getBaseKnowledge() {
  return apiFetch('/base-knowledge');
}

// Pre-loaded HSL document library (parsed once server-side, cached in the browser
// so every module has documents available without uploading).
export async function getLibrary() {
  return apiFetch('/library');
}

// Continuous-learning feedback on any AI output.
export async function submitFeedback({ module, rating, remarks, subject }) {
  return post('/feedback', { module, rating, remarks, subject });
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
