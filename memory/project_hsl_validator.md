---
name: project-hsl-validator
description: Full-stack React+Express maritime design validator — architecture, RAG system, run commands, API key location
metadata:
  type: project
---

Full-stack React+Express POC for HSL (Hindustan Shipyard Ltd) design validation.

**Run:** `npm run dev` from project root (starts both client :3000 and server :5001)

**API key:** stored in browser `localStorage` as `hsl_api_key`; forwarded as `X-Api-Key` header on every request; set via the Settings page in the UI

**Why:** AI-assisted compliance checking against maritime class rules (IRS, DNV, ABS, IACS, IMO, IEC 60092, Naval/NSQR)

**How to apply:** When suggesting changes, keep the CommonJS `require()` module style; everything runs in Node.js 24.

---

## RAG System (as of 2026-06-02)

Full-fledged hybrid RAG — replaced simple TF-IDF with:

| Component | Implementation |
|-----------|----------------|
| Chunking | Recursive section-aware (450 words / 80 overlap), `server/rag/chunker.js` |
| Keyword search | BM25 (k1=1.5, b=0.75), `server/rag/bm25.js` |
| Semantic search | `@xenova/transformers` + `Xenova/all-MiniLM-L6-v2` (384-dim, local ONNX), `server/rag/embedder.js` |
| Vector store | Flat cosine similarity (dot product on normalized vecs), `server/rag/vectorStore.js` |
| Fusion | Reciprocal Rank Fusion (RRF k=60) combining BM25 + vector rankings |
| Diversity | MMR (Maximal Marginal Relevance, λ=0.65), `server/rag/mmr.js` |
| Query expansion | Maritime abbreviation expander (OWS→oily water separator, etc.) + domain templates |
| Embedding cache | Disk-backed JSON at `server/rag/embcache/store.json` (1.3 MB, 172+ vectors) |
| Entry point | `server/rag/index.js` (all public API); `server/rag.js` is a thin wrapper |

**Exports:** `addDocument`, `getDocText`, `retrieve`, `retrieveForDomain`, `retrieveMulti`, `getAllDocs`, `getStatus`, `initializeKnowledgeBase`

All retrieve functions are **async** (await required in callers).

**KB:** 8 static `.txt` files in `server/docs/` → 172 chunks, 172 vectors on startup. New files uploaded via `/api/upload` are also embedded and indexed.

**New debug endpoint:** `GET /api/retrieve?q=...&k=5&domain=Hull` — returns raw retrieval results with scores and sections.

## Server endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/chat | Multi-turn chat; retrieves from last 3 user turns |
| POST | /api/validate | Compliance scan; uses actual doc text if spec is in KB |
| POST | /api/generate-spec | Spec generation with rule-grounded content |
| POST | /api/compare | Document diff (by ID or raw text) |
| POST | /api/upload | PDF/DOCX/TXT ingestion → embeds + indexes |
| GET | /api/retrieve | Debug: raw retrieval with scores |
| GET | /api/kb-status | KB stats (docs, chunks, vectors) |
| GET | /api/documents | List all indexed docs |
| GET | /api/health | Health check |
