// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyProgression } from '@/game/systems/progression';
import { BALANCE } from '@/game/balance';
import { makeWorld } from '../helpers/fixtures';

describe('applyProgression — MANA saturation (INV-MANA-1, D-3)', () => {
  it('keeps mana at the configured max instead of resetting it', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: BALANCE.progression.manaMax,
        score: 0,
        level: 1,
        status: 'playing',
      },
    });
    applyProgression(world);
    expect(world.session.mana).toBe(BALANCE.progression.manaMax);
  });

  it('clamps an overshoot to the configured max', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: BALANCE.progression.manaMax + 50,
        score: 0,
        level: 1,
        status: 'playing',
      },
    });
    applyProgression(world);
    expect(world.session.mana).toBe(BALANCE.progression.manaMax);
  });

  it('clamps a negative mana value to 0', () => {
    const world = makeWorld({
      session: { hp: 3, maxHp: 3, mana: -10, score: 0, level: 1, status: 'playing' },
    });
    applyProgression(world);
    expect(world.session.mana).toBe(0);
  });

  it('leaves mana untouched while below the max', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: BALANCE.progression.manaMax - 1,
        score: 0,
        level: 1,
        status: 'playing',
      },
    });
    applyProgression(world);
    expect(world.session.mana).toBe(BALANCE.progression.manaMax - 1);
  });
});

describe('applyProgression — level-up on score thresholds shrinks the spawn interval with a floor (D-4)', () => {
  it('increments the level exactly once when score just reaches the current threshold, and shrinks the interval by one decay step', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: 0,
        score: BALANCE.progression.levelUpScoreStep,
        level: 1,
        status: 'playing',
      },
      spawner: { intervalRemainSec: 1.2, currentIntervalSec: BALANCE.spawn.initialIntervalSec },
    });
    applyProgression(world);
    expect(world.session.level).toBe(2);
    expect(world.spawner.currentIntervalSec).toBeCloseTo(
      Math.max(
        BALANCE.spawn.minIntervalSec,
        BALANCE.spawn.initialIntervalSec - BALANCE.spawn.intervalDecayPerLevel,
      ),
      5,
    );
  });

  it('does not level up while score is below the threshold', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: 0,
        score: BALANCE.progression.levelUpScoreStep - 1,
        level: 1,
        status: 'playing',
      },
      spawner: { intervalRemainSec: 1.2, currentIntervalSec: BALANCE.spawn.initialIntervalSec },
    });
    applyProgression(world);
    expect(world.session.level).toBe(1);
    expect(world.spawner.currentIntervalSec).toBe(BALANCE.spawn.initialIntervalSec);
  });

  it('can level up multiple times in a single call when score jumps far ahead of the current level', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: 0,
        score: BALANCE.progression.levelUpScoreStep * 5,
        level: 1,
        status: 'playing',
      },
      spawner: { intervalRemainSec: 1.2, currentIntervalSec: BALANCE.spawn.initialIntervalSec },
    });
    applyProgression(world);
    expect(world.session.level).toBeGreaterThan(1);
  });

  it('never shrinks the spawn interval below minIntervalSec regardless of how many levels are gained', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: 0,
        score: BALANCE.progression.levelUpScoreStep * 1000,
        level: 1,
        status: 'playing',
      },
      spawner: { intervalRemainSec: 1.2, currentIntervalSec: BALANCE.spawn.initialIntervalSec },
    });
    applyProgression(world);
    expect(world.spawner.currentIntervalSec).toBeGreaterThanOrEqual(BALANCE.spawn.minIntervalSec);
  });
});

describe('applyProgression — game-over transition (D-6)', () => {
  it('sets status to gameover once hp reaches 0', () => {
    const world = makeWorld({
      session: { hp: 0, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyProgression(world);
    expect(world.session.status).toBe('gameover');
  });

  it('leaves status as playing while hp remains positive', () => {
    const world = makeWorld({
      session: { hp: 1, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyProgression(world);
    expect(world.session.status).toBe('playing');
  });
});
