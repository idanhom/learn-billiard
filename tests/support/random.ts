/**
 * Deterministic pseudo-random source, so property sweeps are reproducible.
 *
 * Shared rather than copied: a sweep that fails on one seed and passes on
 * another is worthless, and two files quietly running different generators
 * under the same seed is exactly how that happens.
 */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
