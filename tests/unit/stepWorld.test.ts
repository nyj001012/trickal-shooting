// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { stepWorld } from '@/game/stepWorld';
import { createRng } from '@/game/rng';
import { BALANCE } from '@/game/balance';
import { makeEnemy, makeInputState, makePlayer, makeWorld } from '../helpers/fixtures';
import type { GameWorld, InputState } from '@/contracts';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

describe('stepWorld — no-op unless status is "playing" (D-6)', () => {
  it('does not mutate the world at all when status is gameover', () => {
    const world = makeWorld({
      session: { hp: 0, maxHp: 3, mana: 0, score: 0, level: 1, status: 'gameover' },
    });
    const before = structuredClone(world);
    stepWorld(world, makeInputState({ right: true }), DT, createRng(1));
    expect(world).toEqual(before);
  });

  it('does not mutate the world at all when status is error', () => {
    const world = makeWorld({
      session: { hp: 1, maxHp: 3, mana: 0, score: 0, level: 1, status: 'error' },
    });
    const before = structuredClone(world);
    stepWorld(world, makeInputState({ right: true }), DT, createRng(1));
    expect(world).toEqual(before);
  });
});

describe('stepWorld — determinism (fixed step + seeded rng => reproducible results)', () => {
  it('produces identical resulting worlds for two independently-created runs given the same seed and the same input sequence', () => {
    const inputs: InputState[] = [
      makeInputState({ right: true }),
      makeInputState({ right: true }),
      makeInputState({ down: true }),
      makeInputState(),
    ];

    function run(): GameWorld {
      const world = makeWorld({ nextEntityId: 0 });
      const rng = createRng(42);
      for (let tick = 0; tick < 200; tick += 1) {
        const input = inputs[tick % inputs.length];
        stepWorld(world, input, DT, rng);
      }
      return world;
    }

    const worldA = run();
    const worldB = run();

    expect(worldA.session).toEqual(worldB.session);
    expect(worldA.player).toEqual(worldB.player);
    expect(worldA.enemies).toEqual(worldB.enemies);
    expect(worldA.regularProjectiles).toEqual(worldB.regularProjectiles);
    expect(worldA.skillProjectiles).toEqual(worldB.skillProjectiles);
    expect(worldA.nextEntityId).toBe(worldB.nextEntityId);
  });
});

describe('stepWorld — automatic player fire (D-2)', () => {
  it('creates a projectile on the first playing tick without a fire input', () => {
    const world = makeWorld({ player: makePlayer({ regularFireCooldownRemainSec: 0 }) });

    stepWorld(world, makeInputState(), DT, createRng(1));

    expect(world.regularProjectiles).toHaveLength(1);
    expect(world.skillProjectiles).toHaveLength(0);
    expect(world.player.regularFireCooldownRemainSec).toBe(BALANCE.player.regularFireCooldownSec);
  });

  it('routes a Space tick exclusively through the skill-projectile path', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: BALANCE.player.skillStartMana,
        score: 0,
        level: 1,
        status: 'playing',
      },
    });

    stepWorld(world, makeInputState({ skill: true }), DT, createRng(1));

    expect(world.regularProjectiles).toHaveLength(0);
    expect(world.skillProjectiles).toHaveLength(1);
    expect(world.session.mana).toBeLessThan(BALANCE.player.skillStartMana);
  });
});

describe('stepWorld — enemy escape has no session side effects (INV-ESCAPE-1)', () => {
  it('applies only direct contact damage when one enemy escapes left and another contacts the player in the same tick', () => {
    const bounds = { width: 800, height: 600 };
    const player = makePlayer({
      x: 400,
      y: 300,
      width: 32,
      height: 32,
      regularFireCooldownRemainSec: 1,
      invulnRemainSec: 0,
    });
    const escapingEnemy = makeEnemy({ id: 1, x: -1000, y: 0, width: 28, height: 28 });
    const contactingEnemy = makeEnemy({
      id: 2,
      x: 400,
      y: 300,
      width: 28,
      height: 28,
      contactDamage: 1,
    });
    const world = makeWorld({
      bounds,
      player,
      enemies: [escapingEnemy, contactingEnemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    stepWorld(world, makeInputState(), DT, createRng(1));

    expect(world.session.hp).toBe(3 - contactingEnemy.contactDamage);
    expect(world.player.invulnRemainSec).toBe(BALANCE.player.invulnSec);
    expect(world.enemies).toHaveLength(0);
  });
});
