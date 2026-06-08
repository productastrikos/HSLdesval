'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Generic JSON-file-backed collection store (one file per collection in data/).
// Used by the Lessons-Learned repository and saved analyses. Simple, durable,
// air-gap-friendly persistence — no external DB required.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function fileFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function ensure(collection, seed = []) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const fp = fileFor(collection);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(seed, null, 2));
}

function readAll(collection, seed = []) {
  ensure(collection, seed);
  try {
    return JSON.parse(fs.readFileSync(fileFor(collection), 'utf8'));
  } catch (_) {
    return [];
  }
}

function writeAll(collection, records) {
  ensure(collection);
  fs.writeFileSync(fileFor(collection), JSON.stringify(records, null, 2));
  return records;
}

function insert(collection, record) {
  const records = readAll(collection);
  const item = {
    id: record.id || `${collection.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    createdAt: new Date().toISOString(),
    ...record,
  };
  records.unshift(item);
  writeAll(collection, records);
  return item;
}

function insertMany(collection, recordsToAdd) {
  const records = readAll(collection);
  const created = [];
  for (const r of recordsToAdd) {
    const item = {
      id: r.id || `${collection.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      createdAt: new Date().toISOString(),
      ...r,
    };
    created.push(item);
  }
  writeAll(collection, [...created, ...records]);
  return created;
}

function remove(collection, id) {
  const records = readAll(collection);
  const next = records.filter(r => r.id !== id);
  writeAll(collection, next);
  return records.length !== next.length;
}

module.exports = { readAll, writeAll, insert, insertMany, remove, DATA_DIR };
