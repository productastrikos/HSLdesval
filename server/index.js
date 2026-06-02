// ─────────────────────────────────────────────────────────────────────────────
// HSL Design Validator — Express API Server
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const rag     = require('./rag');
const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY is not set. Add it to server/.env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getGeminiModel(systemInstruction) {
  const opts = { model: 'gemini-2.0-flash' };
  if (systemInstruction) opts.systemInstruction = systemInstruction;
  return genAI.getGenerativeModel(opts);
}

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Boot: initialise knowledge base (async, non-blocking) ─────────────────────
rag.initializeKnowledgeBase()
  .catch(err => console.error('[RAG] KB init error:', err.message));



// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(context, domain, mode) {
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
Mode: ${mode || 'general'}${contextBlock}`;
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
// CHAT  POST /api/chat
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], domain } = req.body;

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

    const model = getGeminiModel(buildSystemPrompt(context, domain, 'chat'));

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
app.post('/api/validate', async (req, res) => {
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
// GENERATE SPEC  POST /api/generate-spec
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/generate-spec', async (req, res) => {
  try {
    const { domain, vessel, lbp, classSociety, includeNaval } = req.body;

    // Retrieve domain rules + IMO/SOLAS/MARPOL context if relevant
    const [domainRules, generalRules] = await Promise.all([
      rag.retrieveForDomain(domain, 10),
      rag.retrieve(`${classSociety} ${domain} ${vessel} vessel ${lbp}m design requirements`, 4),
    ]);

    const rules = dedupeContext([...domainRules, ...generalRules]).slice(0, 14);

    const prompt = `Generate a complete, rule-compliant technical specification for a ship system.

Parameters:
- Engineering Domain: ${domain}
- Vessel / Project: ${vessel}
- Length Between Perpendiculars (LBP): ${lbp} m
- Classification Society: ${classSociety}
- Include Naval / NSQR clauses: ${includeNaval ? 'Yes' : 'No'}

Applicable rules and standards (use these to provide specific clause citations):
${rules.map(c => {
  const sec = c.section ? ` [${c.section}]` : '';
  return `[${c.source}${sec}]\n${c.text}`;
}).join('\n\n')}

Return a JSON object with this exact structure (no other text):
{
  "sections": [
    { "heading": "Section title", "body": "Detailed content with specific clause references" },
    ...
  ],
  "citations": ["Full citation 1", "Full citation 2", ...]
}

Include these sections (8–10 total):
1. Scope and Application
2. Applicable Rules and Standards
3. Design Basis and Parameters
4. Material Requirements
5. Design Requirements
6. Construction and Fabrication
7. Testing and Inspection
8. Documentation Requirements
${includeNaval ? '9. Naval / NSQR Requirements\n' : ''}
Each section must be detailed (4–8 sentences), reference specific clause numbers, and be appropriate for the ${domain} domain on a ${lbp} m vessel classed by ${classSociety}.`;

    const model  = getGeminiModel();
    const result = await model.generateContent(prompt);
    const text   = result.response.text();
    let sections  = [];
    let citations = [];

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        sections  = parsed.sections  || [];
        citations = parsed.citations || [];
      } catch (_) {}
    }

    // Fallback: parse numbered sections from plain text
    if (!sections.length) {
      const parts = text.split(/\n(?=\d+\.\s+[A-Z])/);
      for (const part of parts) {
        const nl = part.indexOf('\n');
        if (nl > 0) {
          sections.push({
            heading: part.slice(0, nl).replace(/^\d+\.\s+/, '').trim(),
            body:    part.slice(nl + 1).trim(),
          });
        }
      }
    }

    res.json({
      spec: {
        title:    `${domain} System — ${vessel} — Technical Specification`,
        revision: 'Rev.A (AI Draft)',
        sections,
        meta: { vessel, lbp: `${lbp} m`, classSociety, domain },
      },
      citations,
    });
  } catch (err) {
    console.error('[/api/generate-spec]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE DOCUMENTS  POST /api/compare
// Body: { docAId, docBId } OR { docAText, docBText, docAName, docBName }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/compare', async (req, res) => {
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
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { docType, docName } = req.body;
    const name = docName || req.file.originalname;
    let text   = '';
    const mime = req.file.mimetype;

    if (mime === 'application/pdf' || req.file.originalname.endsWith('.pdf')) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(req.file.buffer);
        text = data.text || '';
      } catch (e) {
        console.warn('[upload] pdf-parse failed:', e.message);
        text = `[PDF content — text extraction failed: ${e.message}]`;
      }
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      req.file.originalname.endsWith('.docx')
    ) {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value || '';
    } else {
      text = req.file.buffer.toString('utf8');
    }

    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not extract text from file. Try a text-based PDF or DOCX.' });
    }

    const docId  = 'DOC-' + Date.now();
    const chunks = await rag.addDocument({ id: docId, name, type: docType || 'Upload', text });

    res.json({
      docId,
      name,
      type:       docType || 'Upload',
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
// RETRIEVE (debug / inspection)  GET /api/retrieve?q=...&k=5&domain=Hull
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/retrieve', async (req, res) => {
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
app.get('/api/kb-status', (req, res) => {
  res.json(rag.getStatus());
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS LIST  GET /api/documents
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/documents', (req, res) => {
  res.json(rag.getAllDocs());
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH  GET /api/health
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), ...rag.getStatus() });
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
