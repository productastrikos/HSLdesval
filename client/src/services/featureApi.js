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

// Network-safe fetch — converts a rejected fetch (server down / offline) into a
// clear, actionable error instead of an opaque "Failed to fetch".
async function netFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (_) {
    throw new Error('Cannot reach the server. Please check your connection and that the application is running.');
  }
}

async function handle(res) {
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

async function postJSON(path, body) {
  const res = await netFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return handle(res);
}

async function postForm(path, form) {
  const res = await netFetch(`${API_BASE}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  return handle(res);
}

async function getJSON(path) {
  const res = await netFetch(`${API_BASE}${path}`, { headers: authHeaders() });
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
  const res = await netFetch(`${API_BASE}/export/xlsx`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sheets, filename }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
    throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
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

// ── Shared: build + download a real CSV ──────────────────────────────────────
export async function downloadCsv({ columns, rows = [], filename = 'export' }) {
  const res = await netFetch(`${API_BASE}/export/csv`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ columns, rows, filename }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
    throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${filename.replace(/\.csv$/i, '')}.csv`; a.click();
  URL.revokeObjectURL(url);
  return { kb: Math.round(blob.size / 1024) };
}

// ── Shared: build + download a real OpenDocument Spreadsheet (.ods) ───────────
export async function downloadOds(sheets, filename = 'export') {
  const res = await netFetch(`${API_BASE}/export/ods`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sheets, filename }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
    throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${filename.replace(/\.ods$/i, '')}.ods`; a.click();
  URL.revokeObjectURL(url);
  return { kb: Math.round(blob.size / 1024) };
}

// ── Shared: build + download a Word (.doc) document ──────────────────────────
// payload: { title, subtitle, filename } plus ONE of: { text } | { columns, rows } | { blocks }
export async function downloadWord(payload) {
  const res = await netFetch(`${API_BASE}/export/word`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
    throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `${(payload.filename || payload.title || 'document').replace(/\.docx?$/i, '')}.doc`;
  a.click();
  URL.revokeObjectURL(url);
  return { kb: Math.round(blob.size / 1024) };
}

// ── Shared: build + download a PDF document ──────────────────────────────────
// payload: { title, subtitle, filename } plus ONE of: { text } | { columns, rows } | { blocks }
export async function downloadPdf(payload) {
  const res = await netFetch(`${API_BASE}/export/pdf`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
    throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `${(payload.filename || payload.title || 'document').replace(/\.pdf$/i, '')}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
  return { kb: Math.round(blob.size / 1024) };
}

// ── Feedback (continuous learning) ───────────────────────────────────────────
export async function sendFeedback({ module, rating, remarks, subject }) {
  return postJSON('/feedback', { module, rating, remarks, subject });
}

// ── Audit Log (admin) ────────────────────────────────────────────────────────
export async function getAuditLogs(params = {}) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString();
  return getJSON(`/audit${qs ? `?${qs}` : ''}`);
}
export async function getAuditStats() { return getJSON('/audit/stats'); }

// ── User Interaction History ─────────────────────────────────────────────────
export async function logInteraction(entry)      { return postJSON('/interactions', entry); }
export async function getInteractions(params = {}) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString();
  return getJSON(`/interactions${qs ? `?${qs}` : ''}`);
}
export async function deleteInteraction(id) {
  const res = await netFetch(`${API_BASE}/interactions/${id}`, { method: 'DELETE', headers: authHeaders() });
  return handle(res);
}

// ── Drawing Intelligence ─────────────────────────────────────────────────────
// source: { file } (upload) OR { libraryId } (pre-loaded drawing)
export async function extractDrawing({ file, libraryId, prompt, columns }) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (libraryId) form.append('libraryId', libraryId);
  if (prompt) form.append('prompt', prompt);
  if (columns) form.append('columns', JSON.stringify(columns));
  return postForm('/drawings/extract', form);
}

export async function validateDrawing({ file, libraryId, prompt, buildSpecText, bindingText }) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (libraryId) form.append('libraryId', libraryId);
  if (prompt) form.append('prompt', prompt);
  if (buildSpecText) form.append('buildSpecText', buildSpecText);
  if (bindingText) form.append('bindingText', bindingText);
  return postForm('/drawings/validate', form);
}

export async function compareDrawings({ fileA, libraryIdA, fileB, libraryIdB, prompt }) {
  const form = new FormData();
  if (fileA) form.append('fileA', fileA);
  if (libraryIdA) form.append('libraryIdA', libraryIdA);
  if (fileB) form.append('fileB', fileB);
  if (libraryIdB) form.append('libraryIdB', libraryIdB);
  if (prompt) form.append('prompt', prompt);
  return postForm('/drawings/compare', form);
}

// ── Intelligent Document Converter / Worker ──────────────────────────────────
export async function docworkerExtract(body) { return postJSON('/docworker/extract', body); }
export async function docworkerEdit({ file, docId, text, name, instruction }) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (docId) form.append('docId', docId);
  if (text) form.append('text', text);
  if (name) form.append('name', name);
  form.append('instruction', instruction || '');
  return postForm('/docworker/edit', form);
}

// ── BOM + SOTR generation ────────────────────────────────────────────────────
export async function bomGenerate(body) { return postJSON('/bom/generate', body); }
export async function bomSotr(body)     { return postJSON('/bom/sotr', body); }

// ── Ship Cost Estimation ─────────────────────────────────────────────────────
export async function costVendors()        { return getJSON('/cost/vendors'); }
export async function costEstimate(body)    { return postJSON('/cost/estimate', body); }
export async function costEnquiries(body)   { return postJSON('/cost/enquiries', body); }
export async function costUpdate(body)      { return postJSON('/cost/update', body); }
export async function costCompare(body)      { return postJSON('/cost/compare', body); }
export async function costBqParse(file) {
  const form = new FormData();
  form.append('file', file);
  return postForm('/cost/bq-parse', form);
}

// ── Prompt-driven dashboard analytics ────────────────────────────────────────
export async function dashboardAnalytics(body) { return postJSON('/dashboard/analytics', body); }

// ── Inspection analytics + status tracking ───────────────────────────────────
export async function inspectionAnalytics(params = {}) {
  // Back-compat: a bare string is treated as the project filter.
  const p = typeof params === 'string' ? { project: params } : params;
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== ''))).toString();
  return getJSON(`/inspection/analytics${qs ? `?${qs}` : ''}`);
}
export async function inspectionQuery(body) { return postJSON('/inspection/query', body); }
export async function listInspectionObservations(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return getJSON(`/inspection/observations${qs ? `?${qs}` : ''}`);
}
export async function updateInspectionObservation(id, body) {
  const res = await netFetch(`${API_BASE}/inspection/observations/${id}`, {
    method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
  });
  return handle(res);
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
  const res = await netFetch(`${API_BASE}/lessons/${id}`, { method: 'DELETE', headers: authHeaders() });
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
// → { ttsText, ttsName }. Uploaded documents are held in the browser, so their
// text is sent directly; an id is only a fallback for server-side references.
export function docFields(prefix, v) {
  if (!v) return {};
  if (v.text) return { [`${prefix}Text`]: v.text, [`${prefix}Name`]: v.name };
  if (v.id)   return { [`${prefix}Id`]: v.id, [`${prefix}Name`]: v.name };
  return {};
}
