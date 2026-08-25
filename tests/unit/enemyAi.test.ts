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

describe('updateEnemyAi — reselect timing (INV-EAI-1)', () => {
  it('decrements actionRemainSec by dt and consumes no rng while it remains positive', () => {
    const enemy = makeEnemy({
      action: 'dash',
      actionRemainSec: 1.0,
      dashVx: 77,
      dashVy: -33,
    });
    const world = makeWorld({ enemies: [enemy] });

    updateEnemyAi(world, DT, sequenceRng([]));

    const updated = world.enemies[0];
    expect(updated.actionRemainSec).toBeCloseTo(1.0 - DT, 8);
    expect(updated.action).toBe('dash');
    expect(updated.dashVx).toBe(77);
    expect(updated.dashVy).toBe(-33);
  });

  it('does not touch a dead enemy at all (no decrement, no rng consumption)', () => {
    const enemy = makeEnemy({ alive: false, actionRemainSec: 1.0 });
    const world = makeWorld({ enemies: [enemy] });

    updateEnemyAi(world, DT, sequenceRng([]));

    expect(world.enemies[0].actionRemainSec).toBe(1.0);
  });

  it('reselects immediately (same call) for a freshly-spawned enemy whose actionRemainSec starts at exactly 0', () => {
    const enemy = makeEnemy({ actionRemainSec: 0 });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.4 -> actionIndex bucket 1 -> 'oscillate' (consumes no further rng);
    // the action itself is incidental — this test only asserts a reselection happened.
    updateEnemyAi(world, DT, sequenceRng([0.4, 0.0]));

    const updated = world.enemies[0];
    expect(updated.action).toBe('oscillate');
    expect(updated.actionRemainSec).toBeGreaterThan(0);
  });

  it('reselects the exact tick actionRemainSec decrements from a positive value down to 0', () => {
    const enemy = makeEnemy({ actionRemainSec: DT });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.4 -> actionIndex bucket 1 -> 'oscillate' (consumes no further rng).
    updateEnemyAi(world, DT, sequenceRng([0.4, 0.0]));

    expect(world.enemies[0].actionRemainSec).toBeGreaterThan(0);
  });

  it('rolls the new duration as actionDurationMinSec + rng() * (actionDurationMaxSec - actionDurationMinSec)', () => {
    const enemy = makeEnemy({ actionRemainSec: 0 });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.4 -> actionIndex bucket 1 -> 'oscillate' (consumes no further rng),
    // rng()=0.5 -> the duration roll under test.
    updateEnemyAi(world, DT, sequenceRng([0.4, 0.5]));

    const expected =
      BALANCE.enemyAi.actionDurationMinSec +
      0.5 * (BALANCE.enemyAi.actionDurationMaxSec - BALANCE.enemyAi.actionDurationMinSec);
    expect(world.enemies[0].actionRemainSec).toBeCloseTo(expected, 8);
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
    const enemy = makeEnemy({ actionRemainSec: 0 });
    const world = makeWorld({ enemies: [enemy] });

    // Supply enough trailing values for whichever action gets picked (duration + an
    // optional 3rd draw for dash/circle); unused trailing values are never consumed.
    updateEnemyAi(world, DT, sequenceRng([rngValue, 0.5, 0.5]));

    expect(world.enemies[0].action).toBe(expected);
  });
});

describe('updateEnemyAi — DASH direction selection (INV-EAI-2)', () => {
  const DASH_BUCKET = 0.1; // actionIndex 0 -> 'dash'
  const DURATION_ROLL = 0.5; // irrelevant to direction, kept constant across this block

  it.each(
    FOUR_DIRECTION_TABLE_INDEXES.map((tableIndex, index4) => ({ index4, tableIndex })),
  )(
    'below dashOctoDirectionLevel, maps 4-direction index $index4 through [0,2,4,6] to table index $tableIndex',
    ({ index4, tableIndex }) => {
      const enemy = makeEnemy({ actionRemainSec: 0 });
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

      updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, DURATION_ROLL, dirRng]));

      const updated = world.enemies[0];
      expect(updated.action).toBe('dash');
      const unit = DIRECTION_TABLE[tableIndex];
      expect(updated.dashVx).toBeCloseTo(unit.ux * BALANCE.enemy.speed, 8);
      expect(updated.dashVy).toBeCloseTo(unit.uy * BALANCE.enemy.speed, 8);
    },
  );

  it('clamps the 4-direction index to 3 for the theoretical rng() === 1 edge case', () => {
    const enemy = makeEnemy({ actionRemainSec: 0 });
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

    updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, DURATION_ROLL, 1]));

    const updated = world.enemies[0];
    const unit = DIRECTION_TABLE[FOUR_DIRECTION_TABLE_INDEXES[3]];
    expect(updated.dashVx).toBeCloseTo(unit.ux * BALANCE.enemy.speed, 8);
    expect(updated.dashVy).toBeCloseTo(unit.uy * BALANCE.enemy.speed, 8);
  });

  it.each(DIRECTION_TABLE.map((dir, index) => ({ ...dir, index })))(
    'at or above dashOctoDirectionLevel, uses the full 8-direction table directly at index $index',
    ({ ux, uy, index }) => {
      const enemy = makeEnemy({ actionRemainSec: 0 });
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

      updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, DURATION_ROLL, dirRng]));

      const updated = world.enemies[0];
      expect(updated.dashVx).toBeCloseTo(ux * BALANCE.enemy.speed, 8);
      expect(updated.dashVy).toBeCloseTo(uy * BALANCE.enemy.speed, 8);
    },
  );

  it('clamps the 8-direction index to 7 for the theoretical rng() === 1 edge case', () => {
    const enemy = makeEnemy({ actionRemainSec: 0 });
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

    updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, DURATION_ROLL, 1]));

    const updated = world.enemies[0];
    const last = DIRECTION_TABLE[7];
    expect(updated.dashVx).toBeCloseTo(last.ux * BALANCE.enemy.speed, 8);
    expect(updated.dashVy).toBeCloseTo(last.uy * BALANCE.enemy.speed, 8);
  });

  it('holds dashVx/dashVy constant while actionRemainSec has not yet run out again', () => {
    const enemy = makeEnemy({ actionRemainSec: 0 });
    const world = makeWorld({
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    updateEnemyAi(world, DT, sequenceRng([DASH_BUCKET, DURATION_ROLL, 0]));
    const dashVxAfterSelect = world.enemies[0].dashVx;
    const dashVyAfterSelect = world.enemies[0].dashVy;

    // Still mid-duration: must consume zero rng and leave dashVx/dashVy untouched.
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
      actionRemainSec: 0,
      // stale leftover from a previous OSCILLATE run — must be overwritten, not reused.
      oscillatePhaseSec: 999,
    });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.5 -> actionIndex bucket 1 -> 'oscillate'; rng()=0.2 -> duration roll only.
    updateEnemyAi(world, DT, sequenceRng([0.5, 0.2]));

    const updated = world.enemies[0];
    expect(updated.action).toBe('oscillate');
    expect(updated.oscillateBaseY).toBe(245);
    expect(updated.oscillatePhaseSec).toBe(0);
  });
});

describe('updateEnemyAi — CIRCLE selection (INV-EAI-4)', () => {
  it('resets circleAngleRad to 0 and places the orbit center so the current position lands exactly on angle 0 (no jump)', () => {
    const enemy = makeEnemy({ x: 300, y: 200, width: 28, height: 28, actionRemainSec: 0 });
    const world = makeWorld({ enemies: [enemy] });

    // rng()=0.8 -> actionIndex bucket 2 -> 'circle'; 0.3 -> duration; 0.1 -> circleDir.
    updateEnemyAi(world, DT, sequenceRng([0.8, 0.3, 0.1]));

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
      const enemy = makeEnemy({ actionRemainSec: 0 });
      const world = makeWorld({ enemies: [enemy] });

      updateEnemyAi(world, DT, sequenceRng([0.8, 0.3, rngValue]));

      expect(world.enemies[0].circleDir).toBe(expectedDir);
    },
  );

  it('recenters (no jump) again on a later reselection from a different position', () => {
    const enemy = makeEnemy({
      x: 700,
      y: 50,
      width: 28,
      height: 28,
      action: 'circle',
      actionRemainSec: 0,
      circleCenterX: 999,
      circleCenterY: 999,
      circleAngleRad: 2,
    });
    const world = makeWorld({ enemies: [enemy] });

    updateEnemyAi(world, DT, sequenceRng([0.8, 0.3, 0.9]));

    const updated = world.enemies[0];
    const centerX0 = 700 + 28 / 2;
    const centerY0 = 50 + 28 / 2;
    expect(updated.circleCenterX).toBeCloseTo(centerX0 - BALANCE.enemyAi.circleRadiusPx, 8);
    expect(updated.circleCenterY).toBeCloseTo(centerY0, 8);
    expect(updated.circleAngleRad).toBe(0);
    expect(updated.circleDir).toBe(-1);
  });
});

describe('updateEnemyAi — multiple enemies, array order, rng consumed only by reselecting enemies', () => {
  it('consumes 0 rng for a not-yet-due enemy, 2 for an OSCILLATE reselect, and 3 for a DASH reselect, in world.enemies order', () => {
    const notDue = makeEnemy({ id: 1, actionRemainSec: 5 });
    const oscillateDue = makeEnemy({ id: 2, actionRemainSec: 0 });
    const dashDue = makeEnemy({ id: 3, actionRemainSec: 0 });
    const notDueActionBefore = notDue.action;
    const notDueRemainBefore = notDue.actionRemainSec;
    const world = makeWorld({
      enemies: [notDue, oscillateDue, dashDue],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    // oscillateDue consumes [0.4 (bucket -> oscillate), 0.5 (duration)].
    // dashDue consumes [0.1 (bucket -> dash), 0.5 (duration), 0.2 (direction)].
    updateEnemyAi(world, DT, sequenceRng([0.4, 0.5, 0.1, 0.5, 0.2]));

    expect(world.enemies[0].action).toBe(notDueActionBefore);
    expect(world.enemies[0].actionRemainSec).toBeCloseTo(notDueRemainBefore - DT, 8);
    expect(world.enemies[1].action).toBe('oscillate');
    expect(world.enemies[2].action).toBe('dash');
  });

  it('skips a dead enemy entirely when consuming rng for its still-alive neighbors', () => {
    const dead = makeEnemy({ id: 1, alive: false, actionRemainSec: 0 });
    const alive = makeEnemy({ id: 2, actionRemainSec: 0 });
    const world = makeWorld({ enemies: [dead, alive] });

    updateEnemyAi(world, DT, sequenceRng([0.4, 0.5]));

    expect(world.enemies[1].action).toBe('oscillate');
  });
});

describe('updateEnemyAi — determinism', () => {
  it('reproduces the identical action-selection sequence across many reselection cycles for the same seed, and diverges for a different seed', () => {
    function run(seed: number): string[] {
      const enemy = makeEnemy({ actionRemainSec: 0 });
      const world = makeWorld({ enemies: [enemy] });
      const rng = createRng(seed);
      const actions: string[] = [];
      for (let tick = 0; tick < 500; tick += 1) {
        updateEnemyAi(world, DT, rng);
        actions.push(world.enemies[0].action);
      }
      return actions;
    }

    const a = run(11);
    const b = run(11);
    const c = run(12);

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
