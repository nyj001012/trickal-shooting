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
    const world = makeWorld({ session: { hp: 0, maxHp: 3, mana: 0, score: 0, level: 1, status: 'gameover' } });
    const before = structuredClone(world);
    stepWorld(world, makeInputState({ right: true, fire: true }), DT, createRng(1));
    expect(world).toEqual(before);
  });

  it('does not mutate the world at all when status is error', () => {
    const world = makeWorld({ session: { hp: 1, maxHp: 3, mana: 0, score: 0, level: 1, status: 'error' } });
    const before = structuredClone(world);
    stepWorld(world, makeInputState({ right: true }), DT, createRng(1));
    expect(world).toEqual(before);
  });
});

describe('stepWorld — determinism (fixed step + seeded rng => reproducible results)', () => {
  it('produces identical resulting worlds for two independently-created runs given the same seed and the same input sequence', () => {
    const inputs: InputState[] = [
      makeInputState({ right: true }),
      makeInputState({ right: true, fire: true }),
      makeInputState({ down: true }),
      makeInputState({ fire: true }),
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
    expect(worldA.projectiles).toEqual(worldB.projectiles);
    expect(worldA.nextEntityId).toBe(worldB.nextEntityId);
  });
});

describe('stepWorld — escape damage and contact damage are independent mechanisms (invariants.md INV-DMG-1 scope note)', () => {
  it('reduces HP by escapeDamage + contactDamage in the very same tick when one enemy escapes left AND a different enemy contacts the player, even though both fall inside the same invulnerability window', () => {
    const bounds = { width: 800, height: 600 };
    const player = makePlayer({ x: 400, y: 300, width: 32, height: 32, invulnRemainSec: 0 });
    const escapingEnemy = makeEnemy({ id: 1, x: -1000, y: 0, width: 28, height: 28 });
    const contactingEnemy = makeEnemy({ id: 2, x: 400, y: 300, width: 28, height: 28, contactDamage: 1 });
    const world = makeWorld({
      bounds,
      player,
      enemies: [escapingEnemy, contactingEnemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    stepWorld(world, makeInputState(), DT, createRng(1));

    expect(world.session.hp).toBe(3 - BALANCE.enemy.escapeDamage - contactingEnemy.contactDamage);
  });
});
