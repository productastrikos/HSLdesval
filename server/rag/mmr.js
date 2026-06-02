'use strict';

const { dotProduct } = require('./embedder');

/**
 * Maximal Marginal Relevance selection.
 *
 * Selects k items that balance relevance to the query and diversity among
 * selected items.  lambda=1 → pure relevance; lambda=0 → pure diversity.
 *
 * @param {Array}  candidates  [{ id, score, vec, ...rest }]
 * @param {number} k
 * @param {number} [lambda=0.65]
 * @returns selected subset of candidates
 */
function mmrSelect(candidates, k, lambda = 0.65) {
  if (!candidates.length) return [];
  if (candidates.length <= k) return candidates;

  const selected  = [];
  const remaining = [...candidates];

  // Seed with highest-relevance candidate
  selected.push(remaining.splice(0, 1)[0]);

  while (selected.length < k && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIdx   = 0;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];

      // Max similarity to any already-selected item
      let maxSim = 0;
      if (cand.vec) {
        for (const sel of selected) {
          if (sel.vec) {
            const sim = dotProduct(cand.vec, sel.vec);
            if (sim > maxSim) maxSim = sim;
          }
        }
      }

      // MMR score = λ × relevance − (1−λ) × max_similarity_to_selected
      const mmrScore = lambda * (cand.score || 0) - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

module.exports = { mmrSelect };
