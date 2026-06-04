'use strict';

const { dotProduct } = require('./embedder');

/**
 * In-memory flat vector store with cosine similarity search.
 * Works with pre-normalized vectors (dot product == cosine similarity).
 */
class VectorStore {
  constructor() {
    this._items = [];  // { id, vec: number[], meta }
  }

  add(id, vec, meta = {}) {
    if (!vec) return;
    this._items.push({ id, vec, meta });
  }

  /**
   * Return top-k items by cosine similarity to queryVec.
   * @param {number[]} queryVec   Normalized query vector
   * @param {number}   topK
   * @param {Function} [filter]   Optional fn(meta) → bool
   */
  knn(queryVec, topK = 20, filter = null) {
    if (!queryVec || !this._items.length) return [];
    const pool = filter ? this._items.filter(x => filter(x.meta)) : this._items;
    return pool
      .map(x => ({ id: x.id, score: dotProduct(queryVec, x.vec), meta: x.meta }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  getVec(id) {
    return this._items.find(x => x.id === id)?.vec ?? null;
  }

  remove(ids) {
    const idSet = new Set(ids);
    this._items = this._items.filter(x => !idSet.has(x.id));
  }

  get size() { return this._items.length; }

  clear() { this._items = []; }
}

module.exports = { VectorStore };
