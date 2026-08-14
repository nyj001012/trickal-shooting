// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRng } from '@/game/rng';

describe('createRng — deterministic PRNG (design.md §6.2)', () => {
  it('produces an identical sequence of values for two instances created from the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const sequenceA = Array.from({ length: 20 }, () => a());
    const sequenceB = Array.from({ length: 20 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('always returns a float in [0, 1)', () => {
    const rng = createRng(999);
    for (let i = 0; i < 100; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
