// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnTick } from '@/game/systems/spawner';
import { aabbOverlap } from '@/game/systems/collision';
import { BALANCE } from '@/game/balance';
import { createRng } from '@/game/rng';
import { makeEnemy, makePlayer, makeWorld } from '../helpers/fixtures';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

describe('spawnTick — periodic spawning', () => {
  it('spawns nothing while the interval timer has not yet reached zero, and decrements it by dt', () => {
    const world = makeWorld({ spawner: { intervalRemainSec: 10, currentIntervalSec: 10 } });
    spawnTick(world, DT, createRng(1));
    expect(world.enemies).toHaveLength(0);
    expect(world.spawner.intervalRemainSec).toBeCloseTo(10 - DT, 5);
  });

  it('spawns exactly one enemy once the timer reaches zero, and resets the timer to currentIntervalSec', () => {
    const world = makeWorld({ spawner: { intervalRemainSec: DT / 2, currentIntervalSec: 1.2 } });
    spawnTick(world, DT, createRng(1));
    expect(world.enemies).toHaveLength(1);
    expect(world.spawner.intervalRemainSec).toBeCloseTo(1.2, 5);
  });
});

describe('spawnTick — spawn safety (INV-SPAWN-1, D-4/D-5)', () => {
  it('spawns the enemy exactly at the right bounds edge, never overlapping the player even when the player is clamped at the far-right edge', () => {
    const player = makePlayer({
      x: 800 - BALANCE.player.width,
      y: 300,
      width: BALANCE.player.width,
      height: BALANCE.player.height,
    });
    const world = makeWorld({
      bounds: { width: 800, height: 600 },
      player,
      spawner: { intervalRemainSec: 0, currentIntervalSec: 1.2 },
    });
    spawnTick(world, DT, createRng(7));
    expect(world.enemies).toHaveLength(1);
    const spawned = world.enemies[0];
    expect(spawned.x).toBe(world.bounds.width);
    expect(aabbOverlap(spawned, world.player)).toBe(false);
  });

  it('spawns the enemy within the configured vertical margin', () => {
    const world = makeWorld({ spawner: { intervalRemainSec: 0, currentIntervalSec: 1.2 } });
    spawnTick(world, DT, createRng(3));
    const spawned = world.enemies[0];
    expect(spawned.y).toBeGreaterThanOrEqual(BALANCE.spawn.marginY);
    expect(spawned.y).toBeLessThanOrEqual(
      world.bounds.height - spawned.height - BALANCE.spawn.marginY,
    );
  });
});

describe('spawnTick — entity cap (§6.10 performance budget)', () => {
  it('silently skips spawning (but still resets the timer) once maxEnemies is reached', () => {
    const full = Array.from({ length: BALANCE.limits.maxEnemies }, (_unused, i) =>
      makeEnemy({ id: i }),
    );
    const world = makeWorld({
      enemies: full,
      spawner: { intervalRemainSec: 0, currentIntervalSec: 1.2 },
    });
    spawnTick(world, DT, createRng(1));
    expect(world.enemies).toHaveLength(BALANCE.limits.maxEnemies);
    expect(world.spawner.intervalRemainSec).toBeCloseTo(1.2, 5);
  });
});
