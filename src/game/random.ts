/**
 * Seeded randomness for the game layer.
 *
 * Everything the player is dealt — a layout, where the cue starts — comes from a
 * seed, so any shot can be reproduced exactly from its id.
 */

/** mulberry32 — small, fast, and reproducible across machines. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `items`, each as likely as its weight; `draw` is uniform in [0, 1). */
export function pickWeighted<T>(items: readonly T[], weights: readonly number[], draw: number): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let left = draw * total;
  for (let i = 0; i < items.length; i++) {
    left -= weights[i]!;
    if (left < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** FNV-1a over a string, so a layout id can seed a draw of its own. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
