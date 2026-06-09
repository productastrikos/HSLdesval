'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Suppress known third-party PDF-parser font/rendering noise.
//
// `pdf-parse` bundles an old build of pdf.js that logs font-program warnings
// ("Warning: TT: undefined function: 32", "getPathGenerator - ignoring
// character …", etc.) directly to the console and ignores any verbosity option.
// These are harmless and unactionable. We drop ONLY lines matching these exact
// patterns so genuine logs are never hidden.
// ─────────────────────────────────────────────────────────────────────────────

const NOISE = [
  /^Warning: TT: undefined function/,
  /getPathGenerator - ignoring character/,
  /^Warning: Indexing all PDF objects/,
  /^Setting up fake worker/,
  /^Warning: Unsupported feature/,
  /^Warning: Indexing/,
  /^Warning: Could not find a preferred cmap/,
  /^fontkit/,
];

function isNoise(args) {
  const first = args.length && typeof args[0] === 'string' ? args[0] : '';
  return NOISE.some(re => re.test(first));
}

for (const method of ['log', 'warn', 'error', 'info']) {
  const orig = console[method].bind(console);
  console[method] = (...args) => { if (!isNoise(args)) orig(...args); };
}

module.exports = {};
