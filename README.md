# HSL Design Validator

An AI-driven design-validation workbench for Hindustan Shipyard Limited. It interprets
classification-society rules (IRS/DNV/ABS/IACS), IMO conventions (MARPOL/SOLAS), IEC 60092
electrical standards and Naval/NSQR specifications, and applies them to the documents a user
uploads — compliance checks, drawing data extraction, inspection-report classification,
technical-offer scrutiny, binding-data gap analysis, pre-bid queries and design review.

Everything runs on the local appliance. Language and vision processing are performed by an
**on-premise inference engine**; documents, queries and credentials never leave the network.

---

## 1. How it works

### On-premise inference engine
All generation and document understanding runs server-side through a single local engine
(`server/lib/llm.js`). The browser never receives credentials or raw model output beyond the
finished answer. Vision-capable requests receive page images so scanned pages, figures and
drawings can be read.

### Knowledge base (internal)
On boot, the server parses the reference rule documents in `server/docs/` and indexes them into
a hybrid retrieval engine (BM25 keyword search + local semantic embeddings via
`@xenova/transformers`, fused with RRF and diversified with MMR). These reference sources ground
every AI answer but are **internal to the engine** — they are never listed or shown anywhere in
the application. On first launch they are also cached in the browser (IndexedDB) so they persist
across sessions on that machine.

### Your documents (browser-held)
Documents are uploaded in **one place** — the Document Intelligence page. On upload the server:
1. extracts the text layer page-by-page, and
2. sends any page that has no usable text (scanned pages, image-only pages) to the **vision
   model** for extraction, then
3. **auto-detects the document type** from the content (no manual selection).

The extracted content is stored in the browser and stays available to every tool for the rest of
the session. **Signing out clears all uploaded documents.** Every other page (Design Assistant,
Drawing Extraction, Inspection Reports, Offer Scrutiny, Binding Data, Pre-Bid, Design Review)
presents a **dropdown** to select one of those uploaded documents — they do not upload their own.

---

## 2. Project layout

```
HSLdes_val/
├── server/
│   ├── index.js              # API routes, upload + auto-classification, RAG wiring
│   ├── rag/                  # Hybrid BM25 + semantic retrieval engine
│   ├── docs/                 # Built-in reference rule documents (internal only)
│   ├── lib/
│   │   ├── llm.js            # On-premise inference engine (text + vision)
│   │   ├── extract.js        # Per-page text + vision OCR for image-only pages
│   │   ├── rasterize.js      # PDF → page images (for the vision model)
│   │   └── excel.js          # Workbook generation
│   ├── features/             # Drawings, inspection, lessons, compliance, binding, prebid, review
│   ├── auth/                 # JWT auth + user store
│   └── .env                  # Local engine credentials (server-side only; gitignored)
└── client/
    └── src/
        ├── pages/            # Dashboard, Chatbot, Documents, feature pages, Settings, Users
        ├── components/       # Layout + shared feature UI kit
        └── services/
            ├── aiService.js  # Fetch calls to the backend
            ├── featureApi.js # Feature-route clients
            └── docStore.js   # Browser document store (IndexedDB)
```

---

## 3. Running it

From the project root:

```
npm run dev
```

This starts the API server (port 5001) and the client (port 3000) together. In production the
server also serves the built client from `client/build`.

### Configuration

The local engine credentials live in `server/.env` (server-side only, never sent to the browser):

```
LLM_API_KEY=...            # required
LLM_BASE_URL=...           # optional override
LLM_MODEL=...              # optional override
LLM_VISION_MODEL=...       # optional override
PORT=5001
```

Use **Settings → Test Connection** to confirm the engine is online and the knowledge base has
loaded.

---

## 4. Roles

Two roles, authenticated with JWT (8-hour expiry):

- **Administrator** — all pages plus User Management.
- **Design Engineer** — all analysis pages.

Default accounts are created on first boot (`server/data/users.json`):
`admin / admin123` and `engineer1 / engineer123`.

---

## 5. Security model

- All inference runs locally on the appliance; there is no user-facing cloud configuration.
- Uploaded documents are held only in the browser and are wiped on logout.
- The built-in reference knowledge base is internal to the engine and is never exposed through any
  API listing or UI element.
- All API routes require a bearer token except login and the health check.
