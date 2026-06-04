// ─────────────────────────────────────────────────────────────────────────────
// HSL Design Validator — Express API Server
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const rag     = require('./rag');
const bcrypt  = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sign, authenticate, requireAdmin } = require('./auth/middleware');
const userStore = require('./auth/users');

if (!process.env.GEMINI_API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY is not set. Add it to server/.env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getGeminiModel(systemInstruction) {
  const opts = { model: GEMINI_MODEL };
  if (systemInstruction) opts.systemInstruction = systemInstruction;
  return genAI.getGenerativeModel(opts);
}

// ── Shared file text extractor ────────────────────────────────────────────────
// Supports: PDF (text + scanned/image fallback via Gemini), DOCX, images, plain text.
const IMAGE_MIMES = new Set(['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/bmp','image/tiff']);

async function extractFileText(buffer, mime, origName) {
  const isPDF  = mime === 'application/pdf'  || /\.pdf$/i.test(origName);
  const isDOCX = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(origName);
  const isImg  = IMAGE_MIMES.has(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(origName);

  if (isPDF) {
    let text = '';
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = (data.text || '').trim();
    } catch (_) {}

    // Scanned / image-only PDF — fall back to Gemini vision
    if (text.length < 200) {
      const base64 = buffer.toString('base64');
      const model  = getGeminiModel();
      const result = await model.generateContent([
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        'Extract ALL text from this document exactly as it appears, including text inside images, figures, tables, and diagrams. Preserve structure using line breaks. Output only the extracted text — no commentary.',
      ]);
      text = result.response.text();
    }
    return text;
  }

  if (isDOCX) {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (isImg) {
    const imgMime = IMAGE_MIMES.has(mime) ? mime : 'image/jpeg';
    const base64  = buffer.toString('base64');
    const model   = getGeminiModel();
    const result  = await model.generateContent([
      { inlineData: { mimeType: imgMime, data: base64 } },
      'Extract all visible text from this image exactly as it appears. Preserve layout using line breaks. Output only the extracted text with no commentary.',
    ]);
    return result.response.text();
  }

  return buffer.toString('utf8');
}

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Document types that only administrators may upload
const COMPLIANCE_DOC_TYPES = new Set(['Class Rule', 'IACS', 'IMO', 'IEC', 'Naval', 'Build Spec']);

// ── Boot: initialise knowledge base (async, non-blocking) ─────────────────────
rag.initializeKnowledgeBase()
  .catch(err => console.error('[RAG] KB init error:', err.message));



// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(context, domain, mode, chatDocText, chatDocName) {
  const docBlock = chatDocText
    ? `\n\nUSER-UPLOADED REFERENCE DOCUMENT — "${chatDocName || 'Uploaded Document'}":\nThe user has provided this document as reference context. Prioritise its content when answering:\n\n${chatDocText.slice(0, 8000)}\n\n--- END OF REFERENCE DOCUMENT ---`
    : '';

  const contextBlock = context.length > 0
    ? '\n\nRETRIEVED KNOWLEDGE BASE CONTEXT (ground your answer in these):\n\n' +
      context.map((c, i) => {
        const sec   = c.section ? ` | §${c.section}` : '';
        const score = c.score   ? ` [relevance: ${(c.score * 100).toFixed(0)}%]` : '';
        return `--- [${i + 1}] ${c.source}${sec}${score} ---\n${c.text}`;
      }).join('\n\n')
    : '\n\n(No specific context retrieved — use your general maritime domain knowledge.)';

  return `You are HSL Design Assistant, an expert AI deployed on Hindustan Shipyard Limited's secure intranet. You specialise in:
- IRS (Indian Register of Shipping) classification rules
- DNV, ABS, IACS classification rules and unified requirements
- IMO regulations (MARPOL, SOLAS, and related conventions)
- IEC 60092 series electrical standards for ships
- Naval/NSQR specifications (shock, EMC, NBC, acoustic, magnetic)
- Shipbuilding design, structural analysis, and technical specifications

Always:
- Cite exact clause references (e.g., IRS Pt.3 Ch.6 Sec.4, IEC 60092-352, SOLAS Ch.II-1 Reg.5)
- Be technically precise; use correct units and formula variables
- For compliance checks, give a clear PASS / FAIL / REQUIRES REVIEW verdict with rationale
- Ground answers in the provided context when available; note when you are relying on general knowledge
- Flag safety-critical findings prominently

Current domain focus: ${domain || 'All domains'}
Mode: ${mode || 'general'}${docBlock}${contextBlock}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deduplicate context chunks by text content, keeping highest score. */
function dedupeContext(chunks) {
  const seen = new Map();
  for (const c of chunks) {
    const key  = c.text.slice(0, 60);
    const prev = seen.get(key);
    if (!prev || (c.score || 0) > (prev.score || 0)) seen.set(key, c);
  }
  return [...seen.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH  — public endpoints (no token required)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const user = userStore.findByUsername(username.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = bcrypt.compareSync(password, user.passwordHash);
    if (!valid)  return res.status(401).json({ error: 'Invalid username or password' });

    const token = sign(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    console.error('[/api/auth/login]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health — public (for connectivity check)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), ...rag.getStatus() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated-only routes below this line
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/auth/me
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ── User management (admin only) ──────────────────────────────────────────────

// GET /api/auth/users
app.get('/api/auth/users', authenticate, requireAdmin, (req, res) => {
  res.json(userStore.getAll());
});

// POST /api/auth/users
app.post('/api/auth/users', authenticate, requireAdmin, (req, res) => {
  try {
    const { username, password, fullName, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const user = userStore.create({ username, password, fullName, role });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/auth/users/:id
app.put('/api/auth/users/:id', authenticate, requireAdmin, (req, res) => {
  try {
    // Prevent demoting the last admin
    if (req.body.role === 'user') {
      const admins = userStore.getAll().filter(u => u.role === 'admin');
      if (admins.length === 1 && admins[0].id === req.params.id) {
        return res.status(400).json({ error: 'Cannot demote the last administrator' });
      }
    }
    const updated = userStore.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/auth/users/:id
app.delete('/api/auth/users/:id', authenticate, requireAdmin, (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const admins = userStore.getAll().filter(u => u.role === 'admin');
    const target = userStore.getAll().find(u => u.id === req.params.id);
    if (target?.role === 'admin' && admins.length === 1) {
      return res.status(400).json({ error: 'Cannot delete the last administrator' });
    }
    userStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAT  POST /api/chat
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/chat', authenticate, async (req, res) => {
  try {
    const { messages = [], domain, chatDocText, chatDocName } = req.body;

    // Build retrieval query from up to last 3 user turns for broader context
    const userTurns  = messages.filter(m => m.role === 'user');
    const lastMsg    = userTurns.at(-1)?.content || '';
    const recentCtx  = userTurns.slice(-3).map(m => m.content).join(' ');

    // Run both queries in parallel; pick best combined results
    const [ctxMain, ctxBroad] = await Promise.all([
      rag.retrieve(lastMsg,   5, { domain }),
      rag.retrieve(recentCtx, 3, { domain }),
    ]);

    const context = dedupeContext([...ctxMain, ...ctxBroad]).slice(0, 7);

    const allMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    if (!allMessages.length) return res.status(400).json({ error: 'No messages provided' });

    const model = getGeminiModel(buildSystemPrompt(context, domain, 'chat', chatDocText, chatDocName));

    // Convert prior turns into Gemini history (all but the last user message)
    const history = allMessages.slice(0, -1).map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const lastUserMessage = allMessages.at(-1).content;

    const chat   = model.startChat({ history });
    const result = await chat.sendMessage(lastUserMessage);
    const content = result.response.text();

    const citations  = [...new Set(context.map(c => c.source))].slice(0, 5);
    const ctxDetails = context.map(c => ({ source: c.source, section: c.section || '', score: c.score || 0 }));

    res.json({ content, citations, contextUsed: context.length, contextDetails: ctxDetails });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE  POST /api/validate
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/validate', authenticate, async (req, res) => {
  try {
    const { specId, domain, additionalContext } = req.body;

    // Try to use actual spec text for more targeted retrieval
    const specText  = rag.getDocText(specId) || '';
    const specQuery = specText
      ? specText.slice(0, 600)
      : `${specId} ${domain} build specification compliance check requirements`;

    const [rules, specCtx] = await Promise.all([
      rag.retrieveForDomain(domain, 10),
      rag.retrieve(specQuery, 5),
    ]);

    const allContext = dedupeContext([...rules, ...specCtx]).slice(0, 12);

    const prompt = `Perform a compliance validation scan for Build Specification: ${specId}
Domain: ${domain}
${additionalContext ? `Additional Context: ${additionalContext}` : ''}

Applicable rules and standards (from knowledge base):
${allContext.map(c => {
  const sec = c.section ? ` [${c.section}]` : '';
  return `[${c.source}${sec}]\n${c.text}`;
}).join('\n\n')}

Identify all compliance findings. Return ONLY a valid JSON array — no other text.
Each finding must have exactly these fields:
{
  "ruleId":   string,   // e.g. "IRS-P3-C6-S4" or "SOLAS-II1-R5"
  "section":  string,   // spec section affected, e.g. "§4.2 Bulkhead Spacing"
  "finding":  string,   // precise description of the non-conformance or requirement
  "severity": "critical" | "high" | "medium" | "low",
  "status":   "open" | "in-review" | "resolved",
  "impact":   number    // negative score impact, e.g. -8 for critical
}

Return 4–8 findings covering different rule areas. Reference specific clause numbers where possible.`;

    const model  = getGeminiModel();
    const result = await model.generateContent(prompt);
    const text   = result.response.text();

    let findings = [];
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { findings = JSON.parse(jsonMatch[0]); } catch (_) {}
    }

    res.json({ findings, rawAnalysis: text });
  } catch (err) {
    console.error('[/api/validate]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// COMPARE DOCUMENTS  POST /api/compare
// Body: { docAId, docBId } OR { docAText, docBText, docAName, docBName }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/compare', authenticate, async (req, res) => {
  try {
    let { docAId, docBId, docAText, docBText, docAName, docBName } = req.body;

    if (docAId && !docAText) {
      docAText = rag.getDocText(docAId);
      const meta = rag.getAllDocs().find(d => d.id === docAId);
      docAName  = docAName || meta?.name || docAId;
    }
    if (docBId && !docBText) {
      docBText = rag.getDocText(docBId);
      const meta = rag.getAllDocs().find(d => d.id === docBId);
      docBName  = docBName || meta?.name || docBId;
    }

    if (!docAText || !docBText) {
      return res.status(400).json({ error: 'Both documents are required for comparison.' });
    }

    const A = docAText.slice(0, 6000);
    const B = docBText.slice(0, 6000);

    const prompt = `You are an expert in ship design document comparison. Perform a detailed section-by-section comparison.

Document A — ${docAName || 'Document A'}:
${A}

Document B — ${docBName || 'Document B'}:
${B}

Identify all significant differences. Return ONLY a valid JSON array — no other text.
Each difference must have:
{
  "section":  string,   // section or clause identifier
  "a":        string,   // value / excerpt from Document A
  "b":        string,   // value / excerpt from Document B
  "severity": "critical" | "high" | "medium" | "info",
  "impact":   string    // compliance / design impact description
}

Return 5–12 differences covering structural, numerical, and textual changes.`;

    const model  = getGeminiModel();
    const result = await model.generateContent(prompt);
    const text   = result.response.text();

    let diff = [];
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { diff = JSON.parse(jsonMatch[0]); } catch (_) {}
    }

    res.json({ diff, rawAnalysis: text });
  } catch (err) {
    console.error('[/api/compare]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD DOCUMENT  POST /api/upload
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { docType, docName } = req.body;
    const type = docType || 'Upload';

    // Compliance documents require admin role
    if (COMPLIANCE_DOC_TYPES.has(type) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can upload compliance / guardrail documents.' });
    }

    const name = docName || req.file.originalname;
    const mime = req.file.mimetype;

    const text = await extractFileText(req.file.buffer, mime, req.file.originalname);

    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not extract text from file.' });
    }

    const docId       = 'DOC-' + Date.now();
    const docCategory = COMPLIANCE_DOC_TYPES.has(type) ? 'compliance' : 'vendor';

    const chunks = await rag.addDocument({
      id:             docId,
      name,
      type,
      text,
      uploadedBy:     req.user.username,
      uploadedByRole: req.user.role,
      docCategory,
    });

    res.json({
      docId,
      name,
      type,
      pages:      Math.ceil(text.length / 3000),
      chunks,
      textLength: text.length,
    });
  } catch (err) {
    console.error('[/api/upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERT DOCUMENT  POST /api/convert
// Body (multipart): file, format (TXT | XLSX | DOCX | ODF)
// Returns the converted file as a download.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/convert', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const format   = (req.body.format || 'TXT').toUpperCase();
    const mime     = req.file.mimetype;
    const origName = req.file.originalname;
    const baseName = origName.replace(/\.[^/.]+$/, '');

    // ── Extract text ─────────────────────────────────────────────────────────
    const text = await extractFileText(req.file.buffer, mime, origName);

    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not extract text from file.' });
    }

    // ── Produce output ───────────────────────────────────────────────────────
    if (format === 'XLSX') {
      const XLSX  = require('xlsx');
      const lines = text.split('\n');
      // Build rows: each non-empty line → own row; try to split on common delimiters for table-like content
      const rows = lines.map(line => {
        const cols = line.split(/\t|  {2,}/).map(c => c.trim()).filter(Boolean);
        return cols.length > 1 ? cols : [line];
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Extracted');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      return res.send(buf);
    }

    if (format === 'TXT') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.txt"`);
      return res.send(text);
    }

    // DOCX and ODF: export as plain-text with the requested extension
    // (full DOCX/ODF generation requires additional libraries not in scope)
    const ext = format === 'DOCX' ? 'docx' : 'odt';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${ext}"`);
    return res.send(text);
  } catch (err) {
    console.error('[/api/convert]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVE (debug / inspection)  GET /api/retrieve?q=...&k=5&domain=Hull
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/retrieve', authenticate, async (req, res) => {
  try {
    const { q, k = '5', domain } = req.query;
    if (!q) return res.status(400).json({ error: 'q query parameter is required' });
    const results = await rag.retrieve(q, parseInt(k, 10), { domain: domain || undefined });
    res.json({ query: q, domain: domain || null, count: results.length, results });
  } catch (err) {
    console.error('[/api/retrieve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// KB STATUS  GET /api/kb-status
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/kb-status', authenticate, (req, res) => {
  res.json(rag.getStatus());
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS LIST  GET /api/documents
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/documents', authenticate, (req, res) => {
  res.json(rag.getAllDocs());
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE DOCUMENT  DELETE /api/documents/:id
// Admins can delete any non-system doc. Users can delete only their own.
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/api/documents/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const all = rag.getAllDocs();
    const doc = all.find(d => d.id === id);

    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    if (doc.uploadedBy === 'system') {
      return res.status(403).json({ error: 'System knowledge-base documents cannot be deleted.' });
    }
    if (req.user.role !== 'admin' && doc.uploadedBy !== req.user.username) {
      return res.status(403).json({ error: 'You can only delete documents you uploaded.' });
    }

    rag.removeDocument(id);
    res.json({ success: true, id });
  } catch (err) {
    console.error('[DELETE /api/documents/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAT DOCUMENT EXTRACT  POST /api/chat-extract
// Extracts text from a file and generates AI suggestions for the chatbot.
// Does NOT index the document into the RAG — chatbot-only ephemeral context.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/chat-extract', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const origName = req.file.originalname;
    const mime     = req.file.mimetype;

    const text = await extractFileText(req.file.buffer, mime, origName);

    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not extract text from file.' });
    }

    // Generate document-specific suggestions using Gemini
    const docSample = text.slice(0, 6000);
    const suggestionsPrompt = `Based on the following document content, generate exactly 6 specific and relevant questions or instructions that an engineer would want to ask about this document. Each prompt must be specific to the actual content of this document — not generic.

Document content:
${docSample}

Return ONLY a JSON array of 6 strings — no other text, no numbering, no bullet points, no icons or symbols at the start. Each string is a complete, specific question or instruction directly relevant to this document's content.

Example format: ["Specific question about document content 1", "Specific question about document content 2"]`;

    const model    = getGeminiModel();
    const result   = await model.generateContent(suggestionsPrompt);
    const rawText  = result.response.text();

    let suggestions = [];
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { suggestions = JSON.parse(jsonMatch[0]); } catch (_) {}
    }
    suggestions = (suggestions || []).filter(s => typeof s === 'string').slice(0, 6);

    res.json({
      docName:    origName,
      textLength: text.length,
      text:       text.slice(0, 50000),
      suggestions,
    });
  } catch (err) {
    console.error('[/api/chat-extract]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Serve React build in production
// ─────────────────────────────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '../client/build');
if (fs.existsSync(buildDir)) {
  app.use(express.static(buildDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildDir, 'index.html'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`[HSL Validator API] http://localhost:${PORT}`);
});
