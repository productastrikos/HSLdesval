// ─────────────────────────────────────────────────────────────────────────────
// HSL Design Validator — Express API Server
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
require('./lib/quietLogs');   // drop unactionable third-party PDF font warnings

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const rag     = require('./rag');
const bcrypt  = require('bcryptjs');
const { sign, authenticate, requireAdmin } = require('./auth/middleware');
const userStore = require('./auth/users');

// A missing key is a DEPLOYMENT/config problem, not an app fault — so we never
// crash the process over it (a dead process shows the host's blank 503 page).
// The server still boots; AI routes return a clean "not configured" 503 (see
// lib/llm.js), while login, health and the static site keep working.
if (!process.env.LLM_API_KEY) {
  console.warn('[WARN] LLM_API_KEY is not set — AI features will return a clear "not configured" error until the key is added to the deployment environment. The server is starting normally.');
}

// Node 18+ is required for built-in fetch (used by the inference layer). Warn
// loudly but do NOT crash — login/health/static still work; only AI calls fail,
// and they return a clear message. This makes a wrong Node version easy to spot.
const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);
if (NODE_MAJOR < 18 || typeof fetch !== 'function') {
  console.warn(`[WARN] Node ${process.versions.node} detected — this app needs Node 18+ (for built-in fetch). Set the Node version to 18 or higher in the hosting panel, or AI features will fail.`);
}

// Shared inference + document helpers (single source of truth, reused by feature modules)
const { getModel, generateText, generateJSON } = require('./lib/llm');
const { extractFileText }          = require('./lib/extract');
const { isRendererAvailable }      = require('./lib/rasterize');
const { buildWorkbook }            = require('./lib/excel');
const { buildWordDoc, buildWordTable, buildWordFromText } = require('./lib/word');
const { getFeedbackGuidance }      = require('./features/feedback');

// ── Automatic document-type classification ────────────────────────────────────
// The upload page never asks the user what kind of document they are uploading;
// we infer it from the content. Heuristics first (fast, deterministic), with an
// inference fallback for anything ambiguous.
const DOC_TYPES = [
  'SOTR', 'POTS', 'Technical Offer', 'Binding Data', 'Compliance Matrix',
  'Inspection Report', 'Drawing', 'Build Specification', 'RFP / Tender', 'General Document',
];

function heuristicDocType(text, name = '') {
  const s = `${name}\n${text.slice(0, 4000)}`.toLowerCase();
  if (/\bpots\b|purchase order technical spec/.test(s))            return 'POTS';
  if (/\bsotr\b|statement of technical requirement/.test(s))       return 'SOTR';
  if (/compliance matrix|clause[- ]?by[- ]?clause/.test(s))        return 'Compliance Matrix';
  if (/technical offer|vendor offer|bid offer|quotation/.test(s))  return 'Technical Offer';
  if (/binding data|data sheet|datasheet|guaranteed (data|particulars)/.test(s)) return 'Binding Data';
  if (/inspection report|non[- ]?conformit|ncr\b|observation/.test(s)) return 'Inspection Report';
  if (/cable schedule|single line diagram|\bsld\b|drawing no|drg\.? no/.test(s)) return 'Drawing';
  if (/build specification|building specification/.test(s))        return 'Build Specification';
  if (/request for proposal|\brfp\b|tender|invitation to bid/.test(s)) return 'RFP / Tender';
  return null;
}

async function classifyDocType(text, name = '') {
  const h = heuristicDocType(text, name);
  if (h) return h;
  try {
    const prompt = `Classify the following document into EXACTLY ONE of these categories:
${DOC_TYPES.map(t => `- ${t}`).join('\n')}

Reply with ONLY the category name, nothing else.

Document name: ${name}
Document excerpt:
${text.slice(0, 3000)}`;
    const out = (await generateText(prompt, { temperature: 0, maxOutputTokens: 20 })).trim();
    const match = DOC_TYPES.find(t => out.toLowerCase().includes(t.toLowerCase()));
    return match || 'General Document';
  } catch (_) {
    return 'General Document';
  }
}

const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } = require('./lib/limits');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
Mode: ${mode || 'general'}${getFeedbackGuidance('chat')}${docBlock}${contextBlock}`;
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// GET /api/health — public (for connectivity check)
app.get('/api/health', (req, res) => {
  res.json({
    status:       'ok',
    timestamp:    new Date().toISOString(),
    nodeVersion:  process.versions.node,
    aiConfigured: !!process.env.LLM_API_KEY,   // text + vision both need this
    ocrAvailable: isRendererAvailable(),       // scanned-PDF OCR needs the WASM renderer
    ...rag.getStatus(),
  });
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

    const model = getModel(buildSystemPrompt(context, domain, 'chat', chatDocText, chatDocName));

    // Convert prior turns into chat history (all but the last user message)
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE  POST /api/validate
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/validate', authenticate, async (req, res) => {
  try {
    const { specId, specName, domain, additionalContext } = req.body;
    let { specText } = req.body;

    // Spec text comes from the browser-held document; fall back to RAG by id.
    if (!specText) specText = rag.getDocText(specId) || '';
    const specLabel = specName || specId || 'uploaded document';
    const specQuery = specText
      ? specText.slice(0, 600)
      : `${specLabel} ${domain} build specification compliance check requirements`;

    const [rules, specCtx] = await Promise.all([
      rag.retrieveForDomain(domain, 10),
      rag.retrieve(specQuery, 5),
    ]);

    const allContext = dedupeContext([...rules, ...specCtx]).slice(0, 12);

    const prompt = `Perform a compliance validation scan for: ${specLabel}
Domain: ${domain}
${additionalContext ? `Additional Context: ${additionalContext}` : ''}
${specText ? `\nDocument under review (excerpt):\n${specText.slice(0, 5000)}\n` : ''}
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

    const model  = getModel();
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
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

    const model  = getModel();
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD DOCUMENT  POST /api/upload
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const name = req.body.docName || req.file.originalname;
    const mime = req.file.mimetype;

    // Extract text — pages without a text layer are read by the vision model.
    const text = await extractFileText(req.file.buffer, mime, req.file.originalname);

    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not read this file. It may be empty, password-protected, or a corrupted/incomplete PDF.' });
    }

    // The page never asks for a type — infer it from the content.
    const type = await classifyDocType(text, name);

    const docId = 'DOC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    // The document is NOT indexed server-side: it is returned to the browser,
    // which persists it locally (until logout) and supplies it to features.
    res.json({
      docId,
      name,
      type,
      mime,
      pages:      Math.ceil(text.length / 3000),
      textLength: text.length,
      text,
    });
  } catch (err) {
    console.error('[/api/upload]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERT DOCUMENT  POST /api/convert
// Body (multipart): file, format (TXT | XLSX | DOCX | ODF)
// Returns the converted file as a download.
//
// XLSX conversion is document-type aware. The document is parsed by AI into the
// exact columns of the matching official template, one row per item:
//   • Binding-data / equipment data sheet → equipment-specification register
//   • Everything else (inspection / trial reports) → inspection-remarks register
// ─────────────────────────────────────────────────────────────────────────────
const XLSX_TEMPLATES = {
  binding: {
    sheet:   'Binding Data',
    columns: [
      'S.No',
      'Name of the equipment',
      'Dimensions',
      'Maintenance Envelope',
      'weight of the equipment',
      'Power rating',
      'Heat dissipation',
      'Type of mounting(Bulkhead (wall)/Deck/table top)',
    ],
    intro:    'You are processing a vendor "binding data" / equipment data sheet to build an equipment-specification register. Extract EVERY distinct equipment / system / unit as ONE row.',
    guidance: [
      '- "S.No": leave "" (it is renumbered automatically).',
      '- "Name of the equipment": the equipment / unit / system name or tag.',
      '- "Dimensions": overall size (e.g. L x W x H with units) exactly as stated.',
      '- "Maintenance Envelope": clearance / access space required for maintenance.',
      '- "weight of the equipment": mass with units (kg / t).',
      '- "Power rating": electrical rating as stated (kW / V / A / phase / Hz).',
      '- "Heat dissipation": heat load as stated (W / kW / kCal/h / BTU/h).',
      '- "Type of mounting(Bulkhead (wall)/Deck/table top)": Bulkhead, Deck or Table top when indicated.',
    ].join('\n'),
  },
  inspection: {
    sheet:   'Inspection Remarks',
    columns: [
      'S.No',
      'Name of the project',
      'Name of the equipment /system/material',
      'Name of the inspection agency',
      'Date of the inspection',
      'Document no if any',
      'Trial sl.no',
      'Description of the remark',
      'SAT/UNSAT',
      'classification of the remark',
      'Signed by ',
    ],
    intro:    'You are processing an inspection / trial / technical document to fill an official inspection-remarks register. Extract EVERY distinct remark, observation, defect, non-conformance or trial result as ONE row.',
    guidance: [
      '- "S.No": leave "" (it is renumbered automatically).',
      '- "Description of the remark": the remark / observation / finding text — precise and complete.',
      '- "SAT/UNSAT": "SAT" if satisfactory / acceptable / passed; "UNSAT" if a defect / non-conformance / failure; else "".',
      '- "classification of the remark": Major / Minor / Observation / Critical when indicated, else "".',
      '- Project, equipment/system, inspection agency, date, document no and trial sl.no usually appear in the header/context — repeat them on each row where applicable.',
    ].join('\n'),
  },
};

// Pick the template from the document's content/name (heuristic, no AI call).
function pickXlsxTemplate(text, name = '') {
  const s = `${name}\n${text.slice(0, 4000)}`.toLowerCase();
  if (/binding\s*data|binding\s*dwg|\bbinding\b|data\s*sheet|datasheet|guaranteed\s+(data|particulars)|maintenance\s+envelope|heat\s+dissipation/.test(s)) {
    return XLSX_TEMPLATES.binding;
  }
  return XLSX_TEMPLATES.inspection;
}

async function extractTemplateRows(template, text, docName) {
  const prompt = `${template.intro}

Return ONLY valid JSON of the form: { "rows": [ { ...one object per item... } ] }
Each object MUST use EXACTLY these keys (use "" when the document does not state a value):
${template.columns.map(c => `  - "${c}"`).join('\n')}

Guidance:
${template.guidance}
- Never invent values. Use "" for anything not present in the document.

Document name: ${docName}
Document content:
${text.slice(0, 12000)}`;

  const out  = await generateJSON(prompt, { temperature: 0, maxOutputTokens: 8000 });
  const rows = Array.isArray(out) ? out : (Array.isArray(out?.rows) ? out.rows : []);
  return rows.filter(r => r && typeof r === 'object');
}

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
      // Choose the official template by document type, then AI-extract rows into
      // its exact columns. If extraction fails (e.g. AI unavailable), still emit
      // the correctly formatted template (headers only) so the format is guaranteed.
      const template = pickXlsxTemplate(text, origName);
      let rows = [];
      try {
        rows = await extractTemplateRows(template, text, origName);
      } catch (err) {
        console.warn(`[/api/convert] ${template.sheet} extraction failed — emitting template only:`, err.message);
      }
      rows.forEach((r, i) => { r['S.No'] = String(i + 1); });   // renumber serially

      const buf = await buildWorkbook([{
        name:    template.sheet,
        columns: template.columns,
        rows,
      }]);
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
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
// The pre-loaded knowledge-base documents are internal to the AI/RAG engine and
// are never exposed to the application. Only user-supplied documents are listed.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/documents', authenticate, (req, res) => {
  res.json(rag.getAllDocs().filter(d => d.uploadedBy !== 'system'));
});

// ─────────────────────────────────────────────────────────────────────────────
// BASE KNOWLEDGE  GET /api/base-knowledge
// Returns the parsed text of the built-in knowledge-base documents so the client
// can cache them locally (persisted across sessions). These are used only to
// ground the AI/RAG engine and are never rendered in the UI.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/base-knowledge', authenticate, (req, res) => {
  const docs = rag.getAllDocs()
    .filter(d => d.uploadedBy === 'system')
    .map(d => ({ id: d.id, name: d.name, text: rag.getDocText(d.id) || '' }));
  res.json({ docs, ready: rag.getStatus().ready });
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
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

    // Generate document-specific suggestions using the local inference engine
    const docSample = text.slice(0, 6000);
    const suggestionsPrompt = `Based on the following document content, generate exactly 6 specific and relevant questions or instructions that an engineer would want to ask about this document. Each prompt must be specific to the actual content of this document — not generic.

Document content:
${docSample}

Return ONLY a JSON array of 6 strings — no other text, no numbering, no bullet points, no icons or symbols at the start. Each string is a complete, specific question or instruction directly relevant to this document's content.

Example format: ["Specific question about document content 1", "Specific question about document content 2"]`;

    const model    = getModel();
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
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT TEXT (no indexing)  POST /api/extract-text
// Returns extracted text for a file so feature pages can analyse it without
// adding it to the knowledge base.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/extract-text', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text || !text.trim()) return res.status(422).json({ error: 'Could not extract text from file.' });
    res.json({ name: req.file.originalname, textLength: text.length, text });
  } catch (err) {
    console.error('[/api/extract-text]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT XLSX  POST /api/export/xlsx
// Body: { filename, sheets: [{ name, columns:[label], rows:[obj|array], title?, meta? }] }
// Generic Excel generator used by every feature page's "Download Excel" action.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/export/xlsx', authenticate, async (req, res) => {
  try {
    const { sheets, filename } = req.body;
    if (!Array.isArray(sheets) || !sheets.length) return res.status(400).json({ error: 'sheets[] is required.' });
    const buf  = await buildWorkbook(sheets);
    const safe = (filename || 'export').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.xlsx$/i, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error('[/api/export/xlsx]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT WORD  POST /api/export/word
// Body (any of): { title, subtitle, text }  → prose document (markdown-ish)
//                { title, subtitle, columns, rows } → single-table document
//                { title, subtitle, blocks } → structured blocks
// Produces an editable Word (.doc) file. Used by the Converter, Document Worker,
// BOM and SOTR generators.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/export/word', authenticate, (req, res) => {
  try {
    const { title = 'Document', subtitle = '', text, columns, rows, blocks, filename } = req.body || {};
    let buf;
    if (typeof text === 'string')                 buf = buildWordFromText(title, text, subtitle);
    else if (Array.isArray(columns))              buf = buildWordTable(title, columns, rows || [], subtitle);
    else if (Array.isArray(blocks))               buf = buildWordDoc({ title, subtitle, blocks });
    else return res.status(400).json({ error: 'Provide text, columns+rows, or blocks.' });

    const safe = (filename || title || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.docx?$/i, '');
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.doc"`);
    res.send(buf);
  } catch (err) {
    console.error('[/api/export/word]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature modules (all authenticated)
//   /api/drawings     Extraction of data from drawings (cable schedules, etc.)
//   /api/inspection   Inspection-report → categorised observations
//   /api/lessons      Lessons-Learned repository (+ proactive suggestions)
//   /api/compliance   Technical-offer scrutiny vs TTS → compliance matrix
//   /api/binding      Vendor binding-data review vs POTS → gap analysis
//   /api/prebid       Pre-bid query generation from RFP
//   /api/designreview Design-review checklist + risk assessment
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/drawings',     authenticate, require('./features/drawings'));
app.use('/api/inspection',   authenticate, require('./features/inspection'));
app.use('/api/lessons',      authenticate, require('./features/lessons').router);
app.use('/api/compliance',   authenticate, require('./features/compliance'));
app.use('/api/binding',      authenticate, require('./features/binding'));
app.use('/api/prebid',       authenticate, require('./features/prebid'));
app.use('/api/designreview', authenticate, require('./features/designreview'));
app.use('/api/docworker',    authenticate, require('./features/docworker'));
app.use('/api/bom',          authenticate, require('./features/bom'));
app.use('/api/dashboard',    authenticate, require('./features/dashboard'));
app.use('/api/library',      authenticate, require('./features/library').router);
app.use('/api/feedback',     authenticate, require('./features/feedback').router);

// ─────────────────────────────────────────────────────────────────────────────
// Unknown API endpoint → JSON 404 (must precede the SPA catch-all so unmatched
// /api/* requests never fall through to index.html).
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API endpoint: ${req.method} ${req.originalUrl}` });
});

// ─────────────────────────────────────────────────────────────────────────────
// Serve React build in production
// ─────────────────────────────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '../client/build');
if (fs.existsSync(buildDir)) {
  app.use(express.static(buildDir));
  app.get('*', (req, res, next) => {
    res.sendFile(path.join(buildDir, 'index.html'), err => { if (err) next(err); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Centralised error handler (last middleware). Converts upload-size limits,
// malformed/oversized JSON and any uncaught route error into a consistent JSON
// response. Internal details are logged server-side only; clients get a safe,
// actionable message.
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `The file is too large. The maximum upload size is ${MAX_UPLOAD_MB} MB.`
      : `File upload error: ${err.message}`;
    return res.status(413).json({ error: msg });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'Request body is too large.' });
  }

  console.error('[unhandled]', req.method, req.originalUrl, '—', err && err.stack ? err.stack : err);
  res.status(err.status || 500).json({ error: 'An unexpected server error occurred. Please try again.' });
});

// ── Process-level safety nets — log instead of crashing silently ──────────────
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`[HSL Validator API] http://localhost:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} is already in use. Stop the other process (or set a different PORT) and restart.`);
    process.exit(1);
  }
  console.error('[server error]', err.stack || err.message);
  process.exit(1);
});
