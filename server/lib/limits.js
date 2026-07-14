'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Central resource limits — single source of truth so every upload endpoint
// shares the same cap.
//
// The spec (§2m, §3b-i) requires "uploading any number of documents without any
// restriction". On the mandated on-premise server (512 GB RAM) there is no reason
// to throttle uploads, so the default cap is generous and can be lifted entirely:
//
//   • MAX_UPLOAD_MB  = <n>   → per-file cap of n MB (default 1024 MB / 1 GB)
//   • MAX_UPLOAD_MB  = 0     → NO per-file size limit (truly unlimited)
//
// Uploads to the AI endpoints are buffered in memory (multer.memoryStorage), so
// on a memory-capped host you may still want a cap; override MAX_UPLOAD_MB in the
// deployment environment to suit the hardware.
// ─────────────────────────────────────────────────────────────────────────────

const RAW_MB          = process.env.MAX_UPLOAD_MB;
const MAX_UPLOAD_MB   = RAW_MB === undefined ? 1024 : Math.max(0, parseInt(RAW_MB, 10) || 0);
const UNLIMITED       = MAX_UPLOAD_MB === 0;
// multer treats `undefined` as "no limit"; a finite MB value becomes a byte cap.
const MAX_UPLOAD_BYTES = UNLIMITED ? undefined : MAX_UPLOAD_MB * 1024 * 1024;
// A human-friendly label for UI/health ("Unlimited" vs "1024 MB").
const MAX_UPLOAD_LABEL = UNLIMITED ? 'Unlimited' : `${MAX_UPLOAD_MB} MB`;

module.exports = { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES, UNLIMITED, MAX_UPLOAD_LABEL };
