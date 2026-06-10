'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Dev supervisor — keeps the API alive in development.
//
// `npm run dev` used to run `node server/index.js` directly. If that process
// ever died (a pathological upload, an OOM, an accidental Ctrl-C on one pane,
// or a port clash at boot) it did NOT come back — and from then on every
// request in the browser showed "Cannot reach the server" until a manual
// restart. This wrapper respawns index.js whenever it exits, with a short
// backoff and a crash-loop guard, and gives Node extra heap headroom.
//
// Production does NOT use this: there the platform's process manager
// (Passenger on Hostinger) supervises the app. Only the dev `server` script
// points here — `npm start` still runs index.js directly.
// ─────────────────────────────────────────────────────────────────────────────

const { spawn } = require('child_process');
const path = require('path');

const ENTRY   = path.join(__dirname, 'index.js');
const HEAP_MB = parseInt(process.env.DEV_HEAP_MB || '4096', 10);

// Crash-loop guard: if the child keeps dying within MIN_UPTIME_MS it is almost
// certainly a boot error (syntax error, missing module, or port 5001 already in
// use) rather than a runtime blip. After a few fast crashes, slow the restarts
// right down and say so, instead of scrolling the real error past in a tight
// respawn loop.
const MIN_UPTIME_MS = 3000;
const BACKOFF_MS    = 1500;
const SLOW_AFTER    = 5;
const SLOW_MS       = 8000;

let fastCrashes  = 0;
let child        = null;
let shuttingDown = false;

function start() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [`--max-old-space-size=${HEAP_MB}`, ENTRY], {
    stdio: 'inherit',
    env:   process.env,
  });

  child.on('error', (err) => {
    console.error('[dev-server] failed to spawn index.js:', err.message);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const how    = signal ? `signal ${signal}` : `code ${code}`;
    const uptime = Date.now() - startedAt;
    fastCrashes  = uptime < MIN_UPTIME_MS ? fastCrashes + 1 : 0;

    if (fastCrashes >= SLOW_AFTER) {
      console.error(`\n[dev-server] index.js keeps exiting fast (${how}, last uptime ${uptime}ms).`);
      console.error('[dev-server] Likely a boot error — a syntax error, a missing module, or port 5001 already in use.');
      console.error(`[dev-server] Fix the cause above; retrying in ${SLOW_MS / 1000}s.\n`);
      fastCrashes = 0;
      setTimeout(start, SLOW_MS);
      return;
    }
    console.error(`\n[dev-server] index.js exited (${how}) — restarting in ${BACKOFF_MS}ms…\n`);
    setTimeout(start, BACKOFF_MS);
  });
}

// Forward Ctrl-C / termination to the child and stop supervising (so the user
// can actually quit `npm run dev` instead of the wrapper respawning the API).
function stop(signal) {
  shuttingDown = true;
  if (child) { try { child.kill(signal); } catch (_) { /* already gone */ } }
  process.exit(0);
}
process.on('SIGINT',  () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

console.log(`[dev-server] supervising index.js (heap ${HEAP_MB}MB, auto-restart on exit). Ctrl-C to stop.`);
start();
