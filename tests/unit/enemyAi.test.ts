// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Rng } from '@/contracts';
import { BALANCE } from '@/game/balance';
import { createRng } from '@/game/rng';
import { updateEnemyAi } from '@/game/systems/enemyAi';
import { makeEnemy, makeWorld } from '../helpers/fixtures';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

/**
 * Fixed 8-direction unit-vector table, in the exact order fixed by the contract
 * (identical to the table `FireEnemyProjectiles`/`fireEnemyProjectiles.test.ts` use —
 * duplicated here as a local, production-independent constant per the clean-room rule).
 */
const DIRECTION_TABLE: ReadonlyArray<{ ux: number; uy: number }> = [
  { ux: 1, uy: 0 },
  { ux: Math.SQRT1_2, uy: Math.SQRT1_2 },
  { ux: 0, uy: 1 },
  { ux: -Math.SQRT1_2, uy: Math.SQRT1_2 },
  { ux: -1, uy: 0 },
  { ux: -Math.SQRT1_2, uy: -Math.SQRT1_2 },
  { ux: 0, uy: -1 },
  { ux: Math.SQRT1_2, uy: -Math.SQRT1_2 },
];

/** 4-direction candidate indices map through this fixed table (cardinal-only subset). */
const FOUR_DIRECTION_TABLE_INDEXES = [0, 2, 4, 6] as const;

/**
 * A deterministic `Rng` that returns queued values in order and throws if called more
 * times than values were supplied — lets a test assert "consumes exactly N rng calls"
 * by supplying exactly N values (any extra call is a hard failure, not a silent wrap).
 * This is the primary tool used below to prove the issue #19 regression fix: once an
 * enemy's `actionInitialized` flips to `true`, further `updateEnemyAi` calls must supply
 * an EMPTY rng — any accidental re-roll immediately throws `sequenceRng exhausted`.
 */
function sequenceRng(values: readonly number[]): Rng {
  let cursor = 0;
  return () => {
    if (cursor >= values.length) {
      throw new Error(`sequenceRng exhausted after ${cursor} call(s)`);
    }
    const value = values[cursor];
    cursor += 1;
    return value;
  };
}

describe('updateEnemyAi — one-time selection timing and permanence (INV-EAI-1, 2026-08-28 revision)', () => {
  it('does nothing at all for an already-initialized enemy: 0 rng consumed, no field touched', () => {
    const enemy = makeEnemy({
      actionInitialized: true,
      action: 'dash',
      dashVx: 77,
      dashVy: -33,
    });
    const world = makeWorld({ enemies: [enemy] });

    updateEnemyAi(world, DT, sequenceRng([]));

    const updated = world.enemies[0];
    expect(updated.actionInitialized).toBe(true);
    expect(updated.action).toBe('dash');
    expect(updated.dashVx).toBe(77);
    expect(updated.dashVy).toBe(-33);
  });

  it('does not touch a dead enemy at all (no selection, no rng consumption) even while uninitialized', () => {
    const enemy = makeEnemy({ alive: false, actionInitialized: false });
    const world = makeWorld({ enemies: [enemy] });

    updateEnemyAi(world, DT, sequenceRng([]));

    expect(world.enemies[0].actionInitialized).toBe(false);
  });

  it('selects a real action immediately (same call) for a freshly-spawned enemy whose actionInitialized starts false', () => {
    const enemy = makeEnemy({ actionInitialized: false });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.4 -> actionIndex bucket 1 -> 'oscillate' (consumes no further rng).
    updateEnemyAi(world, DT, sequenceRng([0.4]));

    const updated = world.enemies[0];
    expect(updated.action).toBe('oscillate');
    expect(updated.actionInitialized).toBe(true);
  });

  it('flips actionInitialized to true exactly once and never re-selects on any subsequent tick, across many ticks', () => {
    const enemy = makeEnemy({ actionInitialized: false, x: 500, y: 245 });
    const world = makeWorld({ enemies: [enemy] });

    // Only the values needed for the ONE allowed selection (dash: bucket + direction).
    updateEnemyAi(world, DT, sequenceRng([0.1, 0.2]));

    const afterFirst = { ...world.enemies[0] };
    expect(afterFirst.actionInitialized).toBe(true);
    expect(afterFirst.action).toBe('dash');

    // Regression guard: simulate several more seconds of ticks. Every one of these
    // calls is handed an EMPTY rng — if the implementation ever re-rolls (the exact bug
    // this revision fixes), `sequenceRng` throws immediately instead of silently
    // returning `undefined`/looping.
    for (let tick = 0; tick < 300; tick += 1) {
      updateEnemyAi(world, DT, sequenceRng([]));
    }

    const afterMany = world.enemies[0];
    expect(afterMany.actionInitialized).toBe(true);
    expect(afterMany.action).toBe(afterFirst.action);
    expect(afterMany.dashVx).toBe(afterFirst.dashVx);
    expect(afterMany.dashVy).toBe(afterFirst.dashVy);
    expect(afterMany.oscillateBaseY).toBe(afterFirst.oscillateBaseY);
    expect(afterMany.oscillatePhaseSec).toBe(afterFirst.oscillatePhaseSec);
    expect(afterMany.circleCenterX).toBe(afterFirst.circleCenterX);
    expect(afterMany.circleCenterY).toBe(afterFirst.circleCenterY);
    expect(afterMany.circleAngleRad).toBe(afterFirst.circleAngleRad);
    expect(afterMany.circleDir).toBe(afterFirst.circleDir);
  });

  it('holds an OSCILLATE selection permanently across many ticks with zero further rng consumption', () => {
    const enemy = makeEnemy({ actionInitialized: false, y: 245 });
    const world = makeWorld({ enemies: [enemy] });

    // OSCILLATE consumes exactly 1 rng call for its entire lifetime.
    updateEnemyAi(world, DT, sequenceRng([0.5]));
    const afterFirst = { ...world.enemies[0] };
    expect(afterFirst.action).toBe('oscillate');

    for (let tick = 0; tick < 300; tick += 1) {
      updateEnemyAi(world, DT, sequenceRng([]));
    }

    const afterMany = world.enemies[0];
    expect(afterMany.action).toBe('oscillate');
    expect(afterMany.oscillateBaseY).toBe(afterFirst.oscillateBaseY);
    expect(afterMany.oscillatePhaseSec).toBe(afterFirst.oscillatePhaseSec);
  });

  it('holds a CIRCLE selection permanently across many ticks with zero further rng consumption', () => {
    const enemy = makeEnemy({ actionInitialized: false, x: 300, y: 200, width: 28, height: 28 });
    const world = makeWorld({ enemies: [enemy] });

    // CIRCLE consumes exactly 2 rng calls (bucket + circleDir) for its entire lifetime.
    updateEnemyAi(world, DT, sequenceRng([0.8, 0.1]));
    const afterFirst = { ...world.enemies[0] };
    expect(afterFirst.action).toBe('circle');

    for (let tick = 0; tick < 300; tick += 1) {
      updateEnemyAi(world, DT, sequenceRng([]));
    }

    const afterMany = world.enemies[0];
    expect(afterMany.action).toBe('circle');
    expect(afterMany.circleCenterX).toBe(afterFirst.circleCenterX);
    expect(afterMany.circleCenterY).toBe(afterFirst.circleCenterY);
    expect(afterMany.circleAngleRad).toBe(afterFirst.circleAngleRad);
    expect(afterMany.circleDir).toBe(afterFirst.circleDir);
  });
});

describe('updateEnemyAi — action selection buckets (actionIndex = Math.min(2, Math.floor(rng() * 3)))', () => {
  it.each([
    { rngValue: 0, expected: 'dash' },
    { rngValue: 0.1, expected: 'dash' },
    { rngValue: 1 / 3, expected: 'oscillate' },
    { rngValue: 0.5, expected: 'oscillate' },
    { rngValue: 2 / 3, expected: 'circle' },
    { rngValue: 0.9, expected: 'circle' },
    { rngValue: 0.999999, expected: 'circle' },
    { rngValue: 1, expected: 'circle' }, // clamp edge: floor(3) = 3 -> min(2, 3) = 2
  ] as const)('selects $expected for actionIndex rng()=$rngValue', ({ rngValue, expected }) => {
    const enemy = makeEnemy({ actionInitialized: false });
    const world = makeWorld({ enemies: [enemy] });

    // Supply one trailing value in case the picked action needs a second draw
    // (dash/circle); unused trailing values are never consumed by 'oscillate'.
    updateEnemyAi(world, DT, sequenceRng([rngValue, 0.5]));

    expect(world.enemies[0].action).toBe(expected);
  });
});

describe('updateEnemyAi — DASH direction selection (INV-EAI-2)', () => {
  const DASH_BUCKET = 0.1; // actionIndex 0 -> 'dash'

  it.each(
    FOUR_DIRECTION_TABLE_INDEXES.map((tableIndex, index4) => ({ index4, tableIndex })),
  )(
    'below dashOctoDirectionLevel, maps 4-direction index $index4 through [0,2,4,6] to table index $tableIndex',
    ({ index4, tableIndex }) => {
      const enemy = makeEnemy({ actionInitialized: false });
      const world = makeWorld({
        enemies: [enemy],
        session: {
          hp: 3,
          maxHp: 3,
          mana: 0,
          score: 0,
          level: BALANCE.enemyAi.dashOctoDirectionLevel - 1,
          status: 'playing',
        },
      });
      const dirRng = (index4 + 0.5) / 4;

      updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, dirRng]));

      const updated = world.enemies[0];
      expect(updated.action).toBe('dash');
      const unit = DIRECTION_TABLE[tableIndex];
      expect(updated.dashVx).toBeCloseTo(unit.ux * BALANCE.enemy.speed, 8);
      expect(updated.dashVy).toBeCloseTo(unit.uy * BALANCE.enemy.speed, 8);
    },
  );

  it('clamps the 4-direction index to 3 for the theoretical rng() === 1 edge case', () => {
    const enemy = makeEnemy({ actionInitialized: false });
    const world = makeWorld({
      enemies: [enemy],
      session: {
        hp: 3,
        maxHp: 3,
        mana: 0,
        score: 0,
        level: BALANCE.enemyAi.dashOctoDirectionLevel - 1,
        status: 'playing',
      },
    });

    updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, 1]));

    const updated = world.enemies[0];
    const unit = DIRECTION_TABLE[FOUR_DIRECTION_TABLE_INDEXES[3]];
    expect(updated.dashVx).toBeCloseTo(unit.ux * BALANCE.enemy.speed, 8);
    expect(updated.dashVy).toBeCloseTo(unit.uy * BALANCE.enemy.speed, 8);
  });

  it.each(DIRECTION_TABLE.map((dir, index) => ({ ...dir, index })))(
    'at or above dashOctoDirectionLevel, uses the full 8-direction table directly at index $index',
    ({ ux, uy, index }) => {
      const enemy = makeEnemy({ actionInitialized: false });
      const world = makeWorld({
        enemies: [enemy],
        session: {
          hp: 3,
          maxHp: 3,
          mana: 0,
          score: 0,
          level: BALANCE.enemyAi.dashOctoDirectionLevel,
          status: 'playing',
        },
      });
      const dirRng = (index + 0.5) / 8;

      updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, dirRng]));

      const updated = world.enemies[0];
      expect(updated.dashVx).toBeCloseTo(ux * BALANCE.enemy.speed, 8);
      expect(updated.dashVy).toBeCloseTo(uy * BALANCE.enemy.speed, 8);
    },
  );

  it('clamps the 8-direction index to 7 for the theoretical rng() === 1 edge case', () => {
    const enemy = makeEnemy({ actionInitialized: false });
    const world = makeWorld({
      enemies: [enemy],
      session: {
        hp: 3,
        maxHp: 3,
        mana: 0,
        score: 0,
        level: BALANCE.enemyAi.dashOctoDirectionLevel,
        status: 'playing',
      },
    });

    updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, 1]));

    const updated = world.enemies[0];
    const last = DIRECTION_TABLE[7];
    expect(updated.dashVx).toBeCloseTo(last.ux * BALANCE.enemy.speed, 8);
    expect(updated.dashVy).toBeCloseTo(last.uy * BALANCE.enemy.speed, 8);
  });

  it('holds dashVx/dashVy constant forever once selected — never re-derives them, even after a level change', () => {
    const enemy = makeEnemy({ actionInitialized: false });
    const world = makeWorld({
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, 0]));
    const dashVxAfterSelect = world.enemies[0].dashVx;
    const dashVyAfterSelect = world.enemies[0].dashVy;

    // Simulate a level-up after the fact — must not trigger any re-roll.
    world.session.level = BALANCE.enemyAi.dashOctoDirectionLevel + 5;

    updateEnemyAi(world, DT, sequenceRng([]));

    expect(world.enemies[0].action).toBe('dash');
    expect(world.enemies[0].dashVx).toBe(dashVxAfterSelect);
    expect(world.enemies[0].dashVy).toBe(dashVyAfterSelect);
  });
});

describe('updateEnemyAi — OSCILLATE selection (INV-EAI-3)', () => {
  it('captures the current y as oscillateBaseY and resets oscillatePhaseSec to 0, consuming no extra rng', () => {
    const enemy = makeEnemy({
      y: 245,
      actionInitialized: false,
      // stale leftover from a previous fixture default — must be overwritten, not reused.
      oscillatePhaseSec: 999,
    });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.5 -> actionIndex bucket 1 -> 'oscillate'; no further rng consumed.
    updateEnemyAi(world, DT, sequenceRng([0.5]));

    const updated = world.enemies[0];
    expect(updated.action).toBe('oscillate');
    expect(updated.oscillateBaseY).toBe(245);
    expect(updated.oscillatePhaseSec).toBe(0);
  });
});

describe('updateEnemyAi — CIRCLE selection (INV-EAI-4)', () => {
  it('resets circleAngleRad to 0 and places the orbit center so the current position lands exactly on angle 0 (no jump)', () => {
    const enemy = makeEnemy({
      x: 300,
      y: 200,
      width: 28,
      height: 28,
      actionInitialized: false,
    });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.8 -> actionIndex bucket 2 -> 'circle'; 0.1 -> circleDir.
    updateEnemyAi(world, DT, sequenceRng([0.8, 0.1]));

    const updated = world.enemies[0];
    expect(updated.action).toBe('circle');
    expect(updated.circleAngleRad).toBe(0);

    const centerX0 = 300 + 28 / 2;
    const centerY0 = 200 + 28 / 2;
    expect(updated.circleCenterX).toBeCloseTo(centerX0 - BALANCE.enemyAi.circleRadiusPx, 8);
    expect(updated.circleCenterY).toBeCloseTo(centerY0, 8);

    // Continuity check: plugging angle=0 back into the orbit formula reproduces the
    // pre-selection position exactly — no visible teleport.
    const reconstructedX =
      updated.circleCenterX + BALANCE.enemyAi.circleRadiusPx * Math.cos(0) - updated.width / 2;
    const reconstructedY =
      updated.circleCenterY + BALANCE.enemyAi.circleRadiusPx * Math.sin(0) - updated.height / 2;
    expect(reconstructedX).toBeCloseTo(300, 8);
    expect(reconstructedY).toBeCloseTo(200, 8);
  });

  it.each([
    { rngValue: 0, expectedDir: 1 },
    { rngValue: 0.49, expectedDir: 1 },
    { rngValue: 0.5, expectedDir: -1 },
    { rngValue: 0.99, expectedDir: -1 },
  ] as const)(
    'sets circleDir = $expectedDir for rng()=$rngValue (< 0.5 => 1, else -1)',
    ({ rngValue, expectedDir }) => {
      const enemy = makeEnemy({ actionInitialized: false });
      const world = makeWorld({ enemies: [enemy] });

      updateEnemyAi(world, DT, sequenceRng([0.8, rngValue]));

      expect(world.enemies[0].circleDir).toBe(expectedDir);
    },
  );

  it('never recenters again on a later tick even from a moved position (permanent center/dir, no reselection)', () => {
    const enemy = makeEnemy({
      x: 700,
      y: 50,
      width: 28,
      height: 28,
      action: 'circle',
      actionInitialized: true,
      circleCenterX: 999,
      circleCenterY: 999,
      circleAngleRad: 2,
      circleDir: -1,
    });
    const world = makeWorld({ enemies: [enemy] });

    // Already initialized: must consume 0 rng and leave every circle field untouched,
    // regardless of how far the entity has since moved from its original spawn point.
    updateEnemyAi(world, DT, sequenceRng([]));

    const updated = world.enemies[0];
    expect(updated.circleCenterX).toBe(999);
    expect(updated.circleCenterY).toBe(999);
    expect(updated.circleAngleRad).toBe(2);
    expect(updated.circleDir).toBe(-1);
  });
});

describe('updateEnemyAi — multiple enemies, array order, rng consumed only by uninitialized enemies', () => {
  it('consumes 0 rng for an already-initialized enemy, 1 for an OSCILLATE first-selection, and 2 for a DASH first-selection, in world.enemies order', () => {
    const alreadyInitialized = makeEnemy({ id: 1, actionInitialized: true, action: 'dash' });
    const oscillatePending = makeEnemy({ id: 2, actionInitialized: false });
    const dashPending = makeEnemy({ id: 3, actionInitialized: false });
    const world = makeWorld({
      enemies: [alreadyInitialized, oscillatePending, dashPending],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    // oscillatePending consumes [0.4 (bucket -> oscillate)].
    // dashPending consumes [0.1 (bucket -> dash), 0.2 (direction)].
    updateEnemyAi(world, DT, sequenceRng([0.4, 0.1, 0.2]));

    expect(world.enemies[0].action).toBe('dash');
    expect(world.enemies[0].actionInitialized).toBe(true);
    expect(world.enemies[1].action).toBe('oscillate');
    expect(world.enemies[1].actionInitialized).toBe(true);
    expect(world.enemies[2].action).toBe('dash');
    expect(world.enemies[2].actionInitialized).toBe(true);
  });

  it('skips a dead enemy entirely when consuming rng for its still-uninitialized-but-alive neighbors', () => {
    const dead = makeEnemy({ id: 1, alive: false, actionInitialized: false });
    const alive = makeEnemy({ id: 2, actionInitialized: false });
    const world = makeWorld({ enemies: [dead, alive] });

    updateEnemyAi(world, DT, sequenceRng([0.4]));

    expect(world.enemies[1].action).toBe('oscillate');
  });
});

describe('updateEnemyAi — determinism', () => {
  it('reproduces the identical one-time action selection for the same seed, and diverges for a different seed', () => {
    function run(seed: number): string {
      const enemy = makeEnemy({ actionInitialized: false });
      const world = makeWorld({ enemies: [enemy] });
      const rng = createRng(seed);
      // The first call performs the only selection this enemy will ever get; every
      // subsequent call in this enemy's life must be a permanence no-op.
      for (let tick = 0; tick < 500; tick += 1) {
        updateEnemyAi(world, DT, rng);
      }
      return world.enemies[0].action;
    }

    const a = run(11);
    const b = run(11);
    const c = run(12);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
