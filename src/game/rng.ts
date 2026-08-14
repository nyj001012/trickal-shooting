/**
 * Deterministic PRNG factory (design.md §6.2, §6.0 rule 1 — `src/game/**` never calls
 * `Math.random()` directly). mulberry32: tiny, fast, decent statistical quality for a
 * greybox game's spawn-position/timing needs.
 * @module @/game/rng
 */
import type { CreateRng, Rng } from '@/contracts';

export const createRng: CreateRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
