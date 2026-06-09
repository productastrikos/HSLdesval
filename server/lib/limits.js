'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Central resource limits — single source of truth so every upload endpoint
// shares the same cap. Uploads are buffered in memory (multer.memoryStorage),
// so this limit doubles as a memory guard against OOM on capped hosts.
// Override with MAX_UPLOAD_MB in the deployment environment where you have more
// headroom (e.g. a VPS).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_UPLOAD_MB    = parseInt(process.env.MAX_UPLOAD_MB || '50', 10);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

module.exports = { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES };
