// ─────────────────────────────────────────────────────────────────────────────
// Feature API client — drawings, inspection, lessons, compliance, binding,
// pre-bid, design-review, plus the shared text-extract + Excel-export helpers.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api';

function token() { return localStorage.getItem('auth_token') || ''; }

function authHeaders(extra = {}) {
  const t = token();
  return { ...extra, ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

async function handle(res) {
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

async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return handle(res);
}

async function postForm(path, form) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  return handle(res);
}

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return handle(res);
}

// ── Shared: extract text from a file (no KB indexing) ────────────────────────
export async function extractText(file) {
  const form = new FormData();
  form.append('file', file);
  return postForm('/extract-text', form);
}

// ── Shared: build + download an Excel workbook from sheet specs ───────────────
export async function downloadXlsx(sheets, filename = 'export') {
  const res = await fetch(`${API_BASE}/export/xlsx`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sheets, filename }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/\.xlsx$/i, '')}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return { kb: Math.round(blob.size / 1024) };
}

// ── Drawings ─────────────────────────────────────────────────────────────────
export async function extractDrawing(file, prompt, columns) {
  const form = new FormData();
  form.append('file', file);
  if (prompt) form.append('prompt', prompt);
  if (columns) form.append('columns', JSON.stringify(columns));
  return postForm('/drawings/extract', form);
}

// ── Inspection reports ───────────────────────────────────────────────────────
export async function analyzeInspection({ file, docId, text, name, project, saveToLessons = true }) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (docId) form.append('docId', docId);
  if (text) form.append('text', text);
  if (name) form.append('name', name);
  form.append('project', project || '');
  form.append('saveToLessons', String(saveToLessons));
  return postForm('/inspection/analyze', form);
}

// ── Lessons-Learned repository ───────────────────────────────────────────────
export async function listLessons({ q = '', category = '', system = '', project = '' } = {}) {
  const qs = new URLSearchParams({ q, category, system, project }).toString();
  return getJSON(`/lessons?${qs}`);
}
export async function addLesson(data)    { return postJSON('/lessons', data); }
export async function deleteLesson(id)    {
  const res = await fetch(`${API_BASE}/lessons/${id}`, { method: 'DELETE', headers: authHeaders() });
  return handle(res);
}
export async function suggestLessons({ system, domain, query }) {
  return postJSON('/lessons/suggest', { system, domain, query });
}

// ── Technical-offer compliance matrix ────────────────────────────────────────
export async function complianceMatrix(body)  { return postJSON('/compliance/matrix', body); }

// ── Binding-data gap analysis ────────────────────────────────────────────────
export async function bindingGap(body)        { return postJSON('/binding/gap', body); }

// ── Pre-bid query generation ─────────────────────────────────────────────────
export async function prebidQueries(body)     { return postJSON('/prebid/queries', body); }

// ── Design review + risk ─────────────────────────────────────────────────────
export async function designReview(body)      { return postJSON('/designreview/checklist', body); }

// Convert a DocSource value into request body fields, e.g. docFields('tts', v)
// → { ttsId } or { ttsText, ttsName }
export function docFields(prefix, v) {
  if (!v) return {};
  if (v.id)   return { [`${prefix}Id`]: v.id, [`${prefix}Name`]: v.name };
  if (v.text) return { [`${prefix}Text`]: v.text, [`${prefix}Name`]: v.name };
  return {};
}
