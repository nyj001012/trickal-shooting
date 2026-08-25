// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EnemyProjectile } from '@/contracts';
import { BALANCE } from '@/game/balance';
import { fireEnemyProjectiles } from '@/game/systems/enemyWeapon';
import { makeEnemy, makeEnemyProjectile, makeWorld } from '../helpers/fixtures';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

/** Fixed 8-direction unit-vector table, in the exact order fixed by the contract. */
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

/** rng() that always returns the same constant, landing squarely inside direction bucket i. */
function rngForDirection(i: number): () => number {
  return () => (i + 0.5) / 8;
}

describe('fireEnemyProjectiles — cooldown gate', () => {
  it('does not fire while the cooldown remains positive after decrementing by dt', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 5 });
    const world = makeWorld({ enemies: [enemy] });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemyProjectiles).toHaveLength(0);
    expect(world.enemies[0].projFireCooldownRemainSec).toBeCloseTo(5 - DT, 8);
  });

  it('fires immediately when the cooldown is already at 0', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0 });
    const world = makeWorld({ enemies: [enemy] });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemyProjectiles).toHaveLength(1);
  });

  it('fires the tick the cooldown decrements past zero (floored at 0, not negative)', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: DT / 2 });
    const world = makeWorld({ enemies: [enemy] });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemyProjectiles).toHaveLength(1);
  });

  it('does not fire or decrement the cooldown of a dead enemy', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0, alive: false });
    const world = makeWorld({ enemies: [enemy] });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemyProjectiles).toHaveLength(0);
    expect(world.enemies[0].projFireCooldownRemainSec).toBe(0);
  });
});

describe('fireEnemyProjectiles — 8-direction selection and velocity from the firing enemy projSpeed', () => {
  it.each(DIRECTION_TABLE.map((dir, index) => ({ ...dir, index })))(
    'fires direction index %# with vx/vy = unit vector * the enemy projSpeed',
    ({ ux, uy, index }) => {
      const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0, projSpeed: 213 });
      const world = makeWorld({ enemies: [enemy] });
      fireEnemyProjectiles(world, DT, rngForDirection(index));
      expect(world.enemyProjectiles).toHaveLength(1);
      const projectile = world.enemyProjectiles[0];
      expect(projectile.vx).toBeCloseTo(ux * 213, 8);
      expect(projectile.vy).toBeCloseTo(uy * 213, 8);
      expect(Math.hypot(projectile.vx, projectile.vy)).toBeCloseTo(213, 8);
    },
  );

  it('clamps the direction index to 7 for the theoretical rng() === 1 edge case', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0, projSpeed: 300 });
    const world = makeWorld({ enemies: [enemy] });
    fireEnemyProjectiles(world, DT, () => 1);
    const projectile = world.enemyProjectiles[0];
    const last = DIRECTION_TABLE[7];
    expect(projectile.vx).toBeCloseTo(last.ux * 300, 8);
    expect(projectile.vy).toBeCloseTo(last.uy * 300, 8);
  });

  it('freezes the fired projectile velocity at the enemy own projSpeed snapshot, not a value recomputed from balance directly', () => {
    // A frozen-at-spawn projSpeed (per INV-EPROJ-1) that differs from what
    // BalanceConfig.enemyProjectile would compute for the CURRENT level.
    const enemy = makeEnemy({
      id: 1,
      projFireCooldownRemainSec: 0,
      projSpeed: BALANCE.enemyProjectile.speedBase, // frozen from an earlier, lower level
    });
    const world = makeWorld({
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 50, status: 'playing' }, // current level is high
    });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    const projectile = world.enemyProjectiles[0];
    expect(Math.hypot(projectile.vx, projectile.vy)).toBeCloseTo(
      BALANCE.enemyProjectile.speedBase,
      8,
    );
  });
});

describe('fireEnemyProjectiles — spawned projectile fields', () => {
  it('spawns the projectile centered on the firing enemy AABB with fresh damage/lifetime from balance', () => {
    const enemy = makeEnemy({
      id: 1,
      x: 400,
      y: 300,
      width: 28,
      height: 28,
      projFireCooldownRemainSec: 0,
    });
    const world = makeWorld({ enemies: [enemy], nextEntityId: 500 });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    const projectile = world.enemyProjectiles[0];
    const enemyCenterX = 400 + 28 / 2;
    const enemyCenterY = 300 + 28 / 2;
    expect(projectile.x + projectile.width / 2).toBeCloseTo(enemyCenterX, 5);
    expect(projectile.y + projectile.height / 2).toBeCloseTo(enemyCenterY, 5);
    expect(projectile.width).toBe(BALANCE.enemyProjectile.width);
    expect(projectile.height).toBe(BALANCE.enemyProjectile.height);
    expect(projectile.damage).toBe(BALANCE.enemyProjectile.damage);
    expect(projectile.lifetimeRemainSec).toBe(BALANCE.enemyProjectile.lifetimeSec);
    expect(projectile.kind).toBe('enemyProjectile');
    expect(projectile.alive).toBe(true);
    expect(world.nextEntityId).toBe(501);
  });
});

describe('fireEnemyProjectiles — fire interval reset uses the CURRENT level, not a spawn-time snapshot (INV-EPROJ-2)', () => {
  it('resets the cooldown using a shorter interval after a level-up, independent of the frozen projSpeed', () => {
    const enemy = makeEnemy({
      id: 1,
      projFireCooldownRemainSec: 0,
      projSpeed: BALANCE.enemyProjectile.speedBase, // spawned at level 1
    });
    const level = 10;
    const world = makeWorld({
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level, status: 'playing' },
    });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    const expectedInterval = Math.max(
      BALANCE.enemyProjectile.fireIntervalBase -
        BALANCE.enemyProjectile.fireIntervalDecayPerLevel * (level - 1),
      BALANCE.enemyProjectile.fireIntervalMinSec,
    );
    expect(expectedInterval).toBeLessThan(BALANCE.enemyProjectile.fireIntervalBase);
    expect(world.enemies[0].projFireCooldownRemainSec).toBeCloseTo(expectedInterval, 8);
    // The already-fired projectile's speed is unaffected by the level used for the cooldown reset.
    expect(Math.hypot(world.enemyProjectiles[0].vx, world.enemyProjectiles[0].vy)).toBeCloseTo(
      BALANCE.enemyProjectile.speedBase,
      8,
    );
  });

  it('resets to fireIntervalBase at level 1', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0 });
    const world = makeWorld({
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemies[0].projFireCooldownRemainSec).toBeCloseTo(
      BALANCE.enemyProjectile.fireIntervalBase,
      8,
    );
  });

  it('floors the reset interval at fireIntervalMinSec for a very high level', () => {
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0 });
    const world = makeWorld({
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1000, status: 'playing' },
    });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemies[0].projFireCooldownRemainSec).toBe(
      BALANCE.enemyProjectile.fireIntervalMinSec,
    );
  });

  it('still resets the cooldown at the projectile cap even though creation is skipped', () => {
    const full: EnemyProjectile[] = Array.from(
      { length: BALANCE.limits.maxEnemyProjectiles },
      (_unused, id) => makeEnemyProjectile({ id }),
    );
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0 });
    const world = makeWorld({
      enemies: [enemy],
      enemyProjectiles: full,
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    fireEnemyProjectiles(world, DT, rngForDirection(0));
    expect(world.enemyProjectiles).toHaveLength(BALANCE.limits.maxEnemyProjectiles);
    expect(world.enemies[0].projFireCooldownRemainSec).toBeCloseTo(
      BALANCE.enemyProjectile.fireIntervalBase,
      8,
    );
  });
});

describe('fireEnemyProjectiles — hard cap (§6.10 performance budget, issue #17)', () => {
  it('silently skips creating a new projectile once maxEnemyProjectiles is reached, without consuming rng', () => {
    const full: EnemyProjectile[] = Array.from(
      { length: BALANCE.limits.maxEnemyProjectiles },
      (_unused, id) => makeEnemyProjectile({ id }),
    );
    const enemy = makeEnemy({ id: 1, projFireCooldownRemainSec: 0 });
    const world = makeWorld({
      enemies: [enemy],
      enemyProjectiles: full,
      nextEntityId: 900,
    });
    let rngCalls = 0;
    fireEnemyProjectiles(world, DT, () => {
      rngCalls += 1;
      return 0.5;
    });
    expect(world.enemyProjectiles).toHaveLength(BALANCE.limits.maxEnemyProjectiles);
    expect(world.nextEntityId).toBe(900);
    expect(rngCalls).toBe(0);
  });
});

describe('fireEnemyProjectiles — multiple enemies fire in array order, one rng draw each', () => {
  it('consumes exactly one rng call per enemy that actually fires this tick, in world.enemies order', () => {
    const readyA = makeEnemy({ id: 1, projFireCooldownRemainSec: 0, projSpeed: 100 });
    const notReady = makeEnemy({ id: 2, projFireCooldownRemainSec: 5, projSpeed: 100 });
    const readyB = makeEnemy({ id: 3, projFireCooldownRemainSec: 0, projSpeed: 100 });
    const world = makeWorld({ enemies: [readyA, notReady, readyB] });

    const rngValues = [rngForDirection(0)(), rngForDirection(2)()];
    let cursor = 0;
    fireEnemyProjectiles(world, DT, () => rngValues[cursor++]);

    expect(cursor).toBe(2); // one draw for readyA, one for readyB — none for notReady
    expect(world.enemyProjectiles).toHaveLength(2);
    // readyA (array order 0) consumed the first rng value -> direction index 0 -> (+1, 0)
    expect(world.enemyProjectiles[0].vx).toBeCloseTo(100, 8);
    expect(world.enemyProjectiles[0].vy).toBeCloseTo(0, 8);
    // readyB (array order 2) consumed the second rng value -> direction index 2 -> (0, +1)
    expect(world.enemyProjectiles[1].vx).toBeCloseTo(0, 8);
    expect(world.enemyProjectiles[1].vy).toBeCloseTo(100, 8);
  });
});
