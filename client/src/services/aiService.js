// ─────────────────────────────────────────────────────────────────────────────
// HSL Design Validator — AI Service
// Calls the local Express backend (proxied via React dev server).
// The Gemini API key is configured server-side via server/.env
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api';

// Always true — API key is configured server-side via server/.env
export function isConfigured() { return true; }

// ── Internal fetch helper ─────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}) },
  });
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

/**
 * Send a chat message and receive a Claude response grounded in the RAG KB.
 * @param {Array<{role,content}>} messages - conversation history
 * @param {string} domain - current domain focus
 * @returns {{ content, citations, contextUsed }}
 */
export async function chat(messages, domain) {
  return post('/chat', { messages, domain });
}

/**
 * Run an AI validation scan on a build specification.
 * @param {string} specId
 * @param {string} domain
 * @param {string} [additionalContext]
 * @returns {{ findings, rawAnalysis }}
 */
export async function validate(specId, domain, additionalContext) {
  return post('/validate', { specId, domain, additionalContext });
}

/**
 * Generate a rule-compliant technical specification.
 * @returns {{ spec: { title, revision, sections, meta }, citations }}
 */
export async function generateSpec({ domain, vessel, lbp, classSociety, includeNaval }) {
  return post('/generate-spec', { domain, vessel, lbp, classSociety, includeNaval });
}

/**
 * Compare two documents by their backend IDs.
 * @returns {{ diff, rawAnalysis }}
 */
export async function compareByIds(docAId, docBId, docAName, docBName) {
  return post('/compare', { docAId, docBId, docAName, docBName });
}

/**
 * Compare two documents by their raw text content.
 * @returns {{ diff, rawAnalysis }}
 */
export async function compareByText(docAText, docBText, docAName, docBName) {
  return post('/compare', { docAText, docBText, docAName, docBName });
}

/**
 * Upload a document file to the backend for OCR/parsing and RAG indexing.
 * @param {File} file
 * @param {string} docType
 * @param {string} [docName]
 * @returns {{ docId, name, type, pages, chunks, textLength }}
 */
export async function uploadDocument(file, docType, docName) {
  const form = new FormData();
  form.append('file',    file);
  form.append('docType', docType  || '');
  form.append('docName', docName  || file.name);

  return apiFetch('/upload', { method: 'POST', body: form });
}

/**
 * Fetch the current knowledge base status from the backend.
 * @returns {{ documents, chunks, docs }}
 */
export async function getKbStatus() {
  return apiFetch('/kb-status');
}

/**
 * List all documents currently in the backend KB.
 * @returns {Array<{id, name, type, addedAt}>}
 */
export async function listDocuments() {
  return apiFetch('/documents');
}

/**
 * Test connectivity to the backend server.
 * @returns {{ status, timestamp, documents, chunks }}
 */
export async function testConnection() {
  return apiFetch('/health');
}
