'use strict';

// BM25 parameters (Okapi BM25)
const K1 = 1.5;
const B  = 0.75;

const STOPWORDS = new Set([
  'the','a','an','is','are','of','for','to','in','on','at','by','or','and',
  'that','this','with','from','as','be','was','were','it','its','not','but',
  'have','has','had','do','does','did','will','would','could','should','may',
  'shall','all','any','each','than','then','when','where','which','who','also',
  'per','via','see','ref','note','etc','i.e','e.g','no','if','up','so',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.\-\/]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

class BM25 {
  constructor() {
    this.documents = [];       // { id, tokens, length }
    this.df        = new Map(); // term → document count containing term
    this.avgdl     = 0;
  }

  add(id, text) {
    const tokens = tokenize(text);
    this.documents.push({ id, tokens, length: tokens.length });

    const seen = new Set();
    for (const t of tokens) {
      if (!seen.has(t)) {
        this.df.set(t, (this.df.get(t) || 0) + 1);
        seen.add(t);
      }
    }
    const total = this.documents.reduce((s, d) => s + d.length, 0);
    this.avgdl  = total / this.documents.length;
  }

  search(query, topK = 20) {
    const qTokens = tokenize(query);
    if (!qTokens.length || !this.documents.length) return [];

    const N      = this.documents.length;
    const scores = new Map();

    for (const qt of qTokens) {
      const df = this.df.get(qt) || 0;
      if (!df) continue;

      // BM25 IDF with smoothing
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const doc of this.documents) {
        const tf = doc.tokens.filter(t => t === qt).length;
        if (!tf) continue;

        const score = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.length / this.avgdl));
        scores.set(doc.id, (scores.get(doc.id) || 0) + score);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({ id, score }));
  }

  get size() { return this.documents.length; }

  remove(ids) {
    const idSet = new Set(ids);
    this.documents = this.documents.filter(d => !idSet.has(d.id));
    this.df.clear();
    for (const doc of this.documents) {
      const seen = new Set();
      for (const t of doc.tokens) {
        if (!seen.has(t)) { this.df.set(t, (this.df.get(t) || 0) + 1); seen.add(t); }
      }
    }
    const total = this.documents.reduce((s, d) => s + d.length, 0);
    this.avgdl = this.documents.length ? total / this.documents.length : 0;
  }

  clear() {
    this.documents = [];
    this.df.clear();
    this.avgdl = 0;
  }
}

module.exports = { BM25, tokenize };
