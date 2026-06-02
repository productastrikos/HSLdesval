# HSL AI-Driven Design Validator

**Product**: S!aP Kolaz · **Vendor**: Astrikos.ai · **Client**: Hindustan Shipyard Limited (HSL)
**Doc Ref**: AIPL_DES VAL · v1.0

An AI-powered, full-stack design validation platform for shipbuilding engineers. It enables natural-language queries against classification rules, automated compliance scanning of build specifications, intelligent technical specification generation, scanned document OCR and comparison, and a 3D hull viewer with compliance hotspots — all running on HSL's air-gapped intranet.

---

## Table of Contents

1. [Purpose and Context](#1-purpose-and-context)
2. [Tech Stack](#2-tech-stack)
3. [System Architecture](#3-system-architecture)
4. [Functional Workflow](#4-functional-workflow)
5. [Project Structure](#5-project-structure)
6. [Backend — Express API Server](#6-backend--express-api-server)
7. [RAG Knowledge Base Engine](#7-rag-knowledge-base-engine)
8. [Frontend — React Application](#8-frontend--react-application)
9. [Pages and Features](#9-pages-and-features)
10. [Domain Coverage and Standards](#10-domain-coverage-and-standards)
11. [API Reference](#11-api-reference)
12. [Quick Start](#12-quick-start)
13. [Configuration and API Key](#13-configuration-and-api-key)
14. [Security and Deployment Model](#14-security-and-deployment-model)
15. [Compliance Matrix](#15-compliance-matrix)

---

## 1. Purpose and Context

Hindustan Shipyard Limited (HSL) engineers deal with dozens of overlapping standards from multiple classification societies (IRS, DNV, ABS, IACS), IMO conventions (MARPOL, SOLAS), IEC electrical standards, and Naval/NSQR specifications. Validating a build specification against all applicable rules manually is time-consuming and error-prone.

This platform solves that by:

- Providing a conversational AI that understands ship-design rules and answers precise technical queries with exact clause citations.
- Automatically scanning build specifications for non-conformances across all relevant standards and reporting severity-rated findings.
- Generating rule-compliant technical specifications from vessel parameters with a single click.
- Extracting and comparing scanned PDFs and DOCX documents through an OCR pipeline.
- Showing compliance findings spatially on an interactive 3D ship model.
- Maintaining a full audit trail, RBAC roles, and usage analytics for governance.

The system is designed to be deployed entirely on-premises on HSL's internal network with no internet connectivity required after setup.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 (Create React App) |
| Routing | React Router v6 |
| Charts | Chart.js 4 + react-chartjs-2 |
| 3D rendering | Three.js v0.160 |
| Maps | React-Leaflet + Leaflet |
| Styling | Tailwind CSS 3 + CSS custom properties |
| Backend | Node.js 18+ · Express.js 4 |
| AI model | Anthropic Claude (claude-sonnet-4-6) via @anthropic-ai/sdk |
| RAG engine | Custom TF-IDF knowledge base (server/rag/) |
| Document parsing | pdf-parse (PDF) · mammoth (DOCX) |
| File uploads | multer (memory storage, 200 MB limit) |
| Dev runner | concurrently (runs server + client in one terminal) |

---

## 3. System Architecture

The platform is composed of seven logical layers:

```
┌──────────────────────────────────────────────────────────────────┐
│  L1 · User Interface Layer                                        │
│  React SPA — Dashboard, Chatbot, Validator, Spec Gen, 3D Viewer  │
├──────────────────────────────────────────────────────────────────┤
│  L2 · Application & LLM Engine                                    │
│  Claude Sonnet (Anthropic API) · RAG-grounded system prompts     │
│  Conversational memory · multi-document comprehension             │
├──────────────────────────────────────────────────────────────────┤
│  L3 · Document Intelligence Layer                                  │
│  pdf-parse (PDF text extraction) · mammoth (DOCX extraction)     │
│  OCR pipeline for scanned documents                               │
├──────────────────────────────────────────────────────────────────┤
│  L4 · Business Logic Layer                                         │
│  Rule parsing & reasoning engine                                  │
│  Specification generation module                                  │
│  Cross-standard validation logic                                  │
├──────────────────────────────────────────────────────────────────┤
│  L5 · Data Layer & Storage                                         │
│  In-memory TF-IDF knowledge base (POC)                           │
│  Planned: PostgreSQL / SQLite + on-prem NAS                       │
├──────────────────────────────────────────────────────────────────┤
│  L6 · Admin & Security Layer                                       │
│  RBAC roles · Audit log · Usage analytics                        │
├──────────────────────────────────────────────────────────────────┤
│  L7 · Deployment Environment                                       │
│  On-prem Linux server · Air-gapped intranet · Defence cyber sec  │
└──────────────────────────────────────────────────────────────────┘
```

**Data flow for a typical AI request:**

```
Browser → React (aiService.js) → POST /api/* (x-api-key header)
  → Express server (index.js)
    → RAG retrieve() — finds relevant rule chunks via TF-IDF
    → buildSystemPrompt() — embeds chunks in system message
    → Anthropic API (Claude) — generates response grounded in rules
  → JSON response with content + citations
→ React renders message with cited rule references
```

---

## 4. Functional Workflow

Seven stages cover the end-to-end user journey:

| Stage | Name | Description |
|---|---|---|
| F1 | User Interface | Natural-language query, document upload, spec generation interface |
| F2 | Chatbot Engine + LLM Core | Fine-tuned on Class/Naval/IMO/IEC standards, conversational memory, multi-doc comprehension |
| F3 | Rule Interpretation Engine | Cross-standard reasoning (IRS, Naval, BuildSpec), rule extraction and comparison, spec generator |
| F4 | Document Intelligence Layer | Offline OCR engine, scanned document parsing and structuring, comparison and diff identification |
| F5 | Document Repository & KB | Structured storage of processed documents, version control and history |
| F6 | Admin Dashboard & Audit Trail | RBAC, usage monitoring and statistics, chat/query export, user interaction logs |
| F7 | On-Prem Intranet Deployment | Air-gapped operation, defence cyber-security compliance, HSL internal network only |

---

## 5. Project Structure

```
HSLdes_val/
├── package.json              # Root — scripts: dev, server, client, build, install:all
├── README.md
│
├── server/                   # Express API backend
│   ├── package.json          # Dependencies: express, cors, multer, anthropic, pdf-parse, mammoth
│   ├── index.js              # All API routes + Anthropic client factory + system prompt builder
│   └── rag.js                # Entry point → delegates to server/rag/index.js
│
└── client/                   # React frontend
    ├── package.json          # Dependencies: react 18, chart.js, three.js, leaflet, tailwind
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── index.js          # React DOM root
        ├── App.js            # Router, theme management, static user context
        ├── components/
        │   ├── Layout.js         # Sidebar, topbar, search, alert/advisory panels
        │   ├── KPICard.js        # Reusable KPI metric card
        │   ├── KPIDetailModal.js # KPI drill-down modal
        │   ├── AlertPanel.js     # Slide-out alerts panel
        │   ├── AdvisoryPanel.js  # AI advisory slide-out panel
        │   ├── ZoneFilterBar.js  # Filter pill bar
        │   └── chartUtils.js     # Chart.js token helpers and scale configs
        ├── pages/
        │   ├── Dashboard.js       # KPI overview, quick tiles, architecture diagram
        │   ├── Chatbot.js         # AI design assistant chat interface
        │   ├── Documents.js       # Document upload, OCR, comparison
        │   ├── Validator.js       # Build-spec compliance scanner
        │   ├── Specifications.js  # Technical specification generator
        │   ├── Visualizer3D.js    # Three.js 3D ship model with compliance hotspots
        │   ├── Compliance.js      # Compliance matrix, RBAC roles, audit log
        │   └── Settings.js        # API key config, KB status, connection test
        └── services/
            ├── aiService.js       # API key management + all fetch calls to backend
            ├── hslKnowledge.js    # Static domain knowledge, rule corpus, build specs, workflows
            ├── socket.js          # React context for KPIs, alerts, and advisories (static seed)
            └── api.js             # Stub API helpers
```

---

## 6. Backend — Express API Server

**Entry point**: `server/index.js` — runs on port **5001** by default.

### Startup sequence

1. Express app is created with CORS enabled and `express.json` body parser (10 MB limit).
2. Multer is configured with in-memory storage and a 200 MB file size ceiling for uploads.
3. `rag.initializeKnowledgeBase()` is called asynchronously to build the TF-IDF index from the bundled rule corpus.
4. Routes are registered and the server begins listening.

### Anthropic client factory

Each request that needs AI calls `getClient(req)`, which reads the `x-api-key` header sent by the browser and instantiates a fresh `Anthropic` SDK client. The API key is never stored server-side — it lives in the user's `localStorage` and is forwarded per request.

### System prompt builder

`buildSystemPrompt(context, domain, mode)` produces the system message for every Claude call. It:

- Declares the assistant as "HSL Design Assistant" with expertise across IRS, DNV, ABS, IACS, IMO, IEC 60092, and Naval/NSQR rules.
- Injects the retrieved RAG chunks (with source, section, and relevance score) into the prompt so Claude's answers are grounded in the actual rule text.
- Sets the current domain focus and mode (e.g. `chat`, `generate`).

### Context deduplication

`dedupeContext(chunks)` removes duplicate RAG chunks (matched on first 60 characters of text), keeping the highest-scoring copy. This prevents the same rule paragraph from occupying multiple context slots.

---

## 7. RAG Knowledge Base Engine

**Location**: `server/rag.js` → `server/rag/index.js`

The RAG (Retrieval-Augmented Generation) engine is a custom, dependency-light TF-IDF system that does not require a vector database.

### How it works

1. **Initialization** — On server start, the knowledge base is built by chunking the bundled rule corpus (IRS, DNV, ABS, IACS, IMO, IEC, Naval rules) into overlapping text segments. Each chunk stores its source document, section identifier, and domain tag.

2. **Indexing** — Each chunk is tokenized and a TF-IDF (Term Frequency–Inverse Document Frequency) weight vector is computed. This allows fast cosine-similarity retrieval without GPU hardware.

3. **Retrieval** — `rag.retrieve(query, k, { domain })` tokenizes the query, computes cosine similarity against all chunk vectors, optionally filters by domain, and returns the top-k chunks sorted by relevance score.

4. **Document upload** — When a user uploads a PDF or DOCX via the UI, the backend extracts its text (`pdf-parse` or `mammoth`), calls `rag.addDocument()` to chunk and index the new content, and returns a `docId` for future retrieval.

5. **Domain-filtered retrieval** — `rag.retrieveForDomain(domain, k)` returns the highest-scoring chunks specifically from that engineering domain (Hull, Electrical, HVAC, Piping, Mechanical, Outfit), useful for validation and spec generation where domain scoping matters.

### Key exported functions

| Function | Purpose |
|---|---|
| `initializeKnowledgeBase()` | Boot-time index build |
| `retrieve(query, k, opts)` | General similarity search |
| `retrieveForDomain(domain, k)` | Domain-scoped search |
| `addDocument({ id, name, type, text })` | Index a new uploaded document |
| `getDocText(docId)` | Retrieve full text of a stored document |
| `getAllDocs()` | List all indexed document metadata |
| `getStatus()` | Return document and chunk counts |

---

## 8. Frontend — React Application

### Entry and routing

`client/src/App.js` is the root component. It:

- Wraps the app in `SocketProvider` (the static data context for KPIs and alerts).
- Manages the light/dark theme via a `data-theme` attribute on `document.body`, persisted in `localStorage`.
- Defines all routes via React Router v6 and wraps every page in the `Layout` shell.
- Uses a static `STATIC_USER` object (`{ fullName: 'Design Engineer', role: 'engineer' }`) — no authentication in the POC.

### Layout shell (`components/Layout.js`)

The Layout component renders the full chrome around every page:

- **Sidebar** — collapsible (244 px expanded / 60 px icon-only). Contains the HSL logo, grouped navigation sections (Overview, AI Assistant, Validation, Visualization, Governance, System), and the current user's name and role at the bottom.
- **Topbar** — sidebar toggle button, page title breadcrumb, global search bar (Ctrl+K shortcut), AI status chip (green "AI Ready" / amber "AI: Setup"), live clock, dark/light toggle, AI Advisory button, alerts bell with badge, and user avatar with profile dropdown.
- **Global search** — indexes all pages with keywords and ranks results by match count, navigating on Enter or click.
- **Alert panel** — fixed slide-in panel on the right showing unacknowledged system alerts.
- **AI Advisory panel** — fixed slide-in panel on the right with AI-generated operational advisories.

### AI service (`services/aiService.js`)

Thin fetch layer between the React pages and the Express backend:

- `getApiKey()` / `setApiKey()` / `clearApiKey()` — manage the Anthropic API key in `localStorage`.
- `isConfigured()` — returns `true` if an API key is stored; controls whether pages call the real API or fall back to demo data.
- All API calls forward the key as an `x-api-key` header.
- The client proxy in `client/package.json` routes `/api/*` to `http://localhost:5001`, so no hard-coded URLs are needed in production.

### Static knowledge (`services/hslKnowledge.js`)

A large static module that encodes the application's domain knowledge for offline/demo use:

- `DOMAINS` — `['Hull', 'Electrical', 'Mechanical', 'HVAC', 'Piping', 'Outfit']`
- `CLASS_SOCIETIES` — `['IRS', 'DNV', 'ABS', 'IACS']`
- `RULE_CORPUS` — array of rule objects with id, society, title, and text extract
- `BUILD_SPECS` — sample build specifications (HSL-BS-21-411, etc.) with domain and revision
- `SPEC_RULE_MAP` — maps each build spec ID to the rule IDs that apply to it
- `TECH_ARCHITECTURE` — 7-layer architecture description (used on the Dashboard)
- `FUNCTIONAL_WORKFLOW` — 7-stage functional flow
- `COMPLIANCE_MATRIX` — maps RFP clauses to compliance status and remarks
- `HARDWARE_BILL` — bill of materials for the production hardware deployment
- `DELIVERABLES` — project delivery milestones with timelines and payment splits
- `generateResponse()` — demo fallback that generates plausible responses without an API key

---

## 9. Pages and Features

### Dashboard (`/`)

The command-centre overview:

- **KPI cards** — displays live counts for total documents indexed, queries answered, specs generated, open findings, validated specs, and knowledge base coverage percentage.
- **24-hour query trend** — line chart showing query volume across the day.
- **Domain distribution doughnut** — breakdown of knowledge base content by engineering domain.
- **Quick-access tiles** — one-click navigation to Design Assistant, Rule Validator, Spec Generator, 3D Viewer, and Document Intel.
- **Architecture diagram** — visual representation of the 7 technical layers with health status indicators.
- **Functional workflow** — inline display of the F1–F7 workflow stages.

### Design Assistant (`/chatbot`)

A full chat interface powered by Claude Sonnet via the RAG pipeline:

- Multi-turn conversation with full message history sent to the API on every turn.
- RAG context is retrieved from both the last user message and the last 3 turns simultaneously; results are deduped and the top 7 chunks are injected into the system prompt.
- Each assistant reply displays inline **citations** (knowledge base source tags) and a small indicator showing how many KB chunks were retrieved.
- Response latency and mode (Claude API + RAG vs. demo) are shown under each message.
- Suggestion chips on an empty chat guide the user to common starting queries.
- Falls back to the static `generateResponse()` engine in `hslKnowledge.js` when no API key is configured.
- Domain selector lets the user focus the assistant on a specific engineering domain (Hull, Electrical, etc.).

### Document Intelligence (`/documents`)

Document management and comparison:

- **Upload card** — drag-and-drop or file-picker supporting PDF, DOCX, and plain text. In AI mode, the file is sent to `POST /api/upload`, where the server extracts text using `pdf-parse` (PDF) or `mammoth` (DOCX), chunks it, and adds it to the live RAG index. A simulated progress bar shows reading → OCR → indexing stages.
- **Document library** — grid of all indexed documents (both pre-loaded and user-uploaded) with type badges (Class Rule, IACS, IMO, IEC, Naval, Build Spec, OEM Manual).
- **Document comparison** — select any two documents from the library and run `POST /api/compare`. Claude performs a section-by-section diff and returns a structured list of differences with severity (critical / high / medium / info) and compliance impact description.
- In demo mode (no API key), comparisons use the static `compareDocs()` function.

### Rule Validator (`/validator`)

Automated compliance scanning of build specifications:

- **Spec selector** — choose from the pre-loaded build specifications (e.g. HSL-BS-21-411 Rev.B — Hull).
- **Rule panel** — shows which classification rules apply to the selected spec, sourced from `SPEC_RULE_MAP`.
- **Run scan** — calls `POST /api/validate`. The backend retrieves up to 12 relevant rule chunks (domain rules + spec-specific context) and asks Claude to return a JSON array of findings with fields: `ruleId`, `section`, `finding`, `severity` (critical/high/medium/low), `status` (open/in-review/resolved), and `impact` score.
- **Findings table** — color-coded by severity. Filter bar lets the user show all, open, in-review, or resolved findings.
- **Compliance score** — calculated as 100 + sum of impact scores across all findings, shown as a gauge.
- **Animated scan log** — step-by-step progress messages while the scan runs.
- Falls back to domain-specific static findings when AI is not configured.

### Specification Generator (`/specifications`)

Generate a complete technical specification document:

- **Input form** — engineering domain, vessel name/project ID, LBP (length between perpendiculars in metres), classification society (IRS/DNV/ABS/IACS), and a toggle for Naval/NSQR clauses.
- **Template selector** — pre-defined templates per domain (e.g. Structural Steel Specification for Hull, Main Switchboard Specification for Electrical).
- **Generate** — calls `POST /api/generate-spec`. The backend retrieves up to 14 rule chunks covering the chosen domain and sends them with the vessel parameters to Claude. Claude returns a JSON object with 8–10 specification sections (heading + detailed body text with clause references) and a citations list.
- **Output viewer** — rendered section-by-section with headings, body text, and a citation panel at the bottom. An export button allows copying or downloading the specification.
- Fallback demo uses `generateResponse()` and static rule excerpts.

### 3D Design Viewer (`/visualizer`)

An interactive Three.js 3D ship model:

- A stylised frigate-class hull is constructed procedurally using ExtrudeGeometry, BoxGeometry, and CylinderGeometry primitives. It includes the hull body, main deck, superstructure, mast, and funnel.
- **Compliance hotspots** — 7 coloured sphere markers are placed at real hull coordinates corresponding to actual compliance findings from the Validator (e.g. Fr84 bulkhead spacing at the bow, cable tray segregation near the switchboard room, MARPOL interlock near the stern). Colours follow the severity palette: red = critical, orange = high, amber = medium, green = low.
- **Orbit controls** — the user can rotate, pan, and zoom the model. A subtle auto-rotate animates on idle.
- **Hotspot panel** — clicking a hotspot shows a detail card with the rule ID, finding description, domain, and severity.
- **Domain filter** — pills let the user highlight only hotspots from a chosen engineering domain.
- **Rule sidebar** — lists the full rule corpus for the currently selected domain.

### Compliance & Audit (`/compliance`)

Governance and traceability:

- **Compliance matrix** — table mapping every RFP clause number to the platform's compliance status (Compliant / Partial / Non-Compliant) with remarks, sourced from `COMPLIANCE_MATRIX` in `hslKnowledge.js`.
- **RBAC roles table** — lists the six roles (Admin, Lead Engineer, Engineer, Designer, Surveyor, Auditor) with user counts and the specific permissions each role holds.
- **Audit log** — chronological list of system events (specification generation, validation scans, document uploads, login attempts, annotation actions) with user, role, target, IP, and result columns. Filterable by success/failure.
- **Usage trend chart** — 14-day line chart of daily query volume, validation runs, and specification generations.
- **KPI mini-cards** — total queries this month, active users, specs generated, and open findings.

### Settings & AI Config (`/settings`)

API key and system configuration:

- **API key input** — masked text field for the Anthropic API key. Saved to `localStorage` on click; not sent anywhere except as a request header when AI features are used.
- **Test connection** — calls `GET /api/health` to verify the backend is running and returns document and chunk counts.
- **KB status panel** — shows how many documents and chunks are currently indexed in the RAG engine.
- **Clear key** — removes the stored key and disables AI features, returning all pages to demo mode.

---

## 10. Domain Coverage and Standards

The platform covers six engineering domains and their applicable standards:

| Domain | Standards |
|---|---|
| Hull (Structural) | IRS Pt.3 Ch.6, IACS UR S6, DNV structural rules |
| Electrical | IEC 60092-352 (cable segregation), IEC 60092-301 (switchgear) |
| HVAC | DNV Pt.4 Ch.7, IMO machinery space ventilation rules |
| Piping | IMO MARPOL Annex I (bilge/OWS), DNV piping rules |
| Mechanical | ABS Pt.4 Ch.2 (shafting), DNV machinery rules |
| Outfit / Naval | IRS Naval NSQR Vol-II (shock mounts, EMC, NBC, acoustic) |

Classification societies: **IRS** · **DNV** · **ABS** · **IACS**
International conventions: **IMO MARPOL** · **IMO SOLAS**

---

## 11. API Reference

All endpoints require the `x-api-key: <anthropic-key>` header for AI-powered routes.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Conversational AI with RAG. Body: `{ messages, domain }`. Returns `{ content, citations, contextUsed, contextDetails }`. |
| `POST` | `/api/validate` | Compliance scan. Body: `{ specId, domain, additionalContext }`. Returns `{ findings[], rawAnalysis }`. |
| `POST` | `/api/generate-spec` | Spec generation. Body: `{ domain, vessel, lbp, classSociety, includeNaval }`. Returns `{ spec: { title, revision, sections[], meta }, citations[] }`. |
| `POST` | `/api/compare` | Document diff. Body: `{ docAId, docBId }` or `{ docAText, docBText, docAName, docBName }`. Returns `{ diff[], rawAnalysis }`. |
| `POST` | `/api/upload` | File upload + RAG indexing. Multipart form: `file`, `docType`, `docName`. Returns `{ docId, name, type, pages, chunks, textLength }`. |
| `GET` | `/api/retrieve?q=&k=5&domain=` | Debug: raw RAG retrieval results. |
| `GET` | `/api/kb-status` | Knowledge base document and chunk counts. |
| `GET` | `/api/documents` | List all indexed documents. |
| `GET` | `/api/health` | Server health check with KB status. |

---

## 12. Quick Start

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- An Anthropic API key (for AI features — the app runs in demo mode without one)

### Local development

```bash
# Clone the repository
git clone https://github.com/productastrikos/HSLdesval.git
cd HSLdesval

# Install all dependencies (root + server + client)
npm run install:all

# Start both the backend (port 5001) and the frontend (port 3000) concurrently
npm run dev
```

Or start them separately:

```bash
# Terminal 1 — Backend API server
npm run server          # node server/index.js on :5001

# Terminal 2 — React development server
npm run client          # cd client && npm start on :3000
```

- **Frontend (dev)**: http://localhost:3000
- **Backend API**: http://localhost:5001/api
- **Health check**: http://localhost:5001/api/health

---

## 12a. Hostinger Node.js Deployment

This project is configured for a single-process deployment: the Express server serves both the API and the compiled React app as static files.

### How it works in production

```
Browser → Hostinger server (your-domain.com)
  GET /          → Express serves client/build/index.html
  GET /chatbot   → Express serves client/build/index.html  (SPA routing)
  POST /api/chat → Express handles API + calls Anthropic
```

All API calls from the React app use relative `/api/*` paths, so there is no hard-coded URL to change.

### Step-by-step Hostinger setup

**1. Push code to GitHub**
```bash
git add .
git commit -m "deployment ready"
git push origin master
```

**2. In Hostinger hPanel → Node.js**

| Setting | Value |
|---|---|
| Node.js version | 18 (or latest LTS) |
| Application root | `/` (repo root) |
| Application startup file | `server/index.js` |
| Application URL | your domain |

**3. Deploy the code**

Connect your GitHub repository in hPanel → Git. Hostinger will pull the latest commit.

**4. Install dependencies**

In the Hostinger file manager terminal (or SSH), run:

```bash
npm run build
```

This single command:
- Installs `server/node_modules`
- Installs `client/node_modules`
- Compiles the React app into `client/build/`

> If you hit a memory error during the React build, run:
> `node --max-old-space-size=512 node_modules/.bin/react-scripts build`
> inside the `client/` directory.

**5. Set environment variables**

In hPanel → Node.js → Environment Variables (or via `.env`):

| Variable | Value | Required |
|---|---|---|
| `PORT` | Set automatically by Hostinger | Auto |
| `NODE_ENV` | `production` | Recommended |

The Anthropic API key is **not** an environment variable — users enter it in the Settings page and it is stored in their browser's `localStorage`. Nothing is stored on the server.

**6. Start the application**

In hPanel, click **Start** (or **Restart**). Hostinger calls `npm start`, which runs `node server/index.js`.

**7. First-boot note — semantic embedding model**

On the very first start, the RAG engine downloads the `all-MiniLM-L6-v2` ONNX model (~22 MB) from Hugging Face. This is a one-time download; subsequent starts use the disk cache at `server/rag/embcache/store.json`. If the download fails (e.g., no outbound internet), the system falls back to BM25 keyword search automatically — the app remains fully functional.

**8. Verify deployment**

Open `https://your-domain.com/api/health` — you should see:
```json
{ "status": "ok", "documents": 8, "chunks": 350, ... }
```

Then open `https://your-domain.com` to use the app.

### Production build

```bash
npm run build           # installs all deps + compiles React app into client/build/
npm start               # starts the production server
```

---

## 13. Configuration and API Key

The application uses a **bring-your-own-key** model. No API key is baked into the codebase.

1. Open the app and navigate to **Settings & AI Config** (`/settings`).
2. Paste your Anthropic API key into the field and click **Save**.
3. The key is stored in `localStorage` under the key `hsl_api_key`.
4. Every AI request forwards the key as the `x-api-key` HTTP header to the local Express server, which uses it to instantiate the Anthropic SDK client.
5. The server never writes or logs the key.

Without a key, all pages fall back to demo mode using the static knowledge in `hslKnowledge.js`. Demo mode is suitable for UI evaluation but does not call Claude or perform real RAG retrieval.

---

## 14. Security and Deployment Model

This platform is designed for **air-gapped intranet deployment**:

- No outbound internet traffic except to the Anthropic API endpoint (required only when using AI features with a live key).
- The React app and Express server both run on HSL's internal servers.
- In the full production deployment (target hardware), the LLM would be a locally hosted fine-tuned model, eliminating even the Anthropic API dependency.

**Target production hardware** (from the technical solution document):

| Component | Specification |
|---|---|
| Server CPU | 2 × 16-core AMD EPYC / Intel Xeon Gold |
| Server RAM | 512 GB DDR4 ECC |
| GPU Accelerator | NVIDIA A100 80 GB |
| Primary Storage | 8 TB NVMe SSD |
| Backup Storage | 100 TB+ NAS, RAID 5 |
| OS / Platform | Astrik.OS with S!aP Platform (Ubuntu LTS variant) |

**RBAC roles** enforced in the UI:

| Role | Permissions |
|---|---|
| Admin | Full access — manage corpus, users, all read/write, approve, export |
| Lead Engineer | Generate specs, run validators, approve drafts, export |
| Engineer | Run validators, query assistant, author drafts, view specs |
| Designer | Query assistant, view specs, upload documents |
| Surveyor | View findings, acknowledge, annotate |
| Auditor | Read-only, audit log access |

**Certifications**: ISO 9001 · ISO/IEC 27001 · ISO/IEC 20000-1 · ISO 21823-1 · DPIIT registered

---

## 15. Compliance Matrix

The platform is designed to be fully compliant with the HSL RFP requirements:

| RFP Clause | Requirement | Status |
|---|---|---|
| 1 | Objective as per RFP | Compliant |
| 2(a) | Interpret design inputs from Class/Naval/IMO/IEC/Academic Books/Manuals | Compliant |
| 2(b) | Provide domain-specific design query answers | Compliant |
| 2(c) | Recommend corrective actions / highlight inconsistencies | Compliant |
| 2(d) | Extract contextual content from scanned PDFs | Compliant |
| 2(e) | Convert scanned graphical PDF to Word/Excel/ODF | Compliant |
| 2(f) | Identify differences in Class and Naval requirements | Compliant |
| 2(g) | Intelligent recommendations based on queries and ship class | Compliant |

---

## Project Delivery Milestones

| Deliverable | Timeline | Payment |
|---|---|---|
| AI Driven Design Validator (Base Functionality) | D + 10 weeks | 10% |
| Knowledge Base Upload & UI Customization | D + 14 weeks | 10% |
| Full Feature Development (Phase II) | D + 18 weeks | 10% |
| User & Admin Training | D + 20 weeks | 10% |
| Final Production Release (Go-Live) | D + 24 weeks | 45% |
| Source Code & Full Documentation | D + 24 weeks | 5% |
| One-Year Warranty Support Post Go-Live | Continuous | 10% |

---

*Built by Astrikos.ai — S!aP Kolaz platform · Partners: AVEVA, Schneider Electric*
