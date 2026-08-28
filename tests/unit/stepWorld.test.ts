// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { stepWorld } from '@/game/stepWorld';
import { createRng } from '@/game/rng';
import { BALANCE } from '@/game/balance';
import {
  makeEnemy,
  makeHealingItem,
  makeInputState,
  makePlayer,
  makeRegularProjectile,
  makeWorld,
} from '../helpers/fixtures';
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

  it('reproduces steering trajectories for the same skill-fire seed and changes them for a different seed', () => {
    function run(seed: number): GameWorld {
      const world = makeWorld({
        enemies: [makeEnemy({ x: 700, y: 100 })],
        session: { hp: 3, maxHp: 3, mana: 100, score: 0, level: 1, status: 'playing' },
        spawner: { intervalRemainSec: 999, currentIntervalSec: 999 },
      });
      const rng = createRng(seed);
      for (let tick = 0; tick < 20; tick += 1) {
        stepWorld(world, makeInputState({ skill: true }), DT, rng);
      }
      return world;
    }

    const worldA = run(42);
    const worldB = run(42);
    const worldWithDifferentSeed = run(43);

    expect(worldA.skillProjectiles).toHaveLength(3);
    expect(worldA.skillProjectiles).toEqual(worldB.skillProjectiles);
    expect(worldA.skillProjectiles).not.toEqual(worldWithDifferentSeed.skillProjectiles);
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

describe('stepWorld — updateEnemyAi assigns a real action to a freshly-spawned enemy the same tick it spawns (issue #19, INV-EAI-1)', () => {
  it('spawns an enemy with actionInitialized flipped to true and a valid action after one stepWorld tick', () => {
    const world = makeWorld({
      spawner: { intervalRemainSec: 0, currentIntervalSec: 1.2 },
    });

    stepWorld(world, makeInputState(), DT, createRng(7));

    expect(world.enemies).toHaveLength(1);
    const spawned = world.enemies[0];
    expect(['dash', 'oscillate', 'circle']).toContain(spawned.action);
    expect(spawned.actionInitialized).toBe(true);
  });

  it('leaves the freshly-spawned enemy at exactly x = bounds.width (updateEnemyAi never writes x/y, and applyMovement already ran earlier in the same tick, before spawnTick)', () => {
    // Confirms the System Execution Order: applyMovement (3) runs before spawnTick (4)
    // and updateEnemyAi (5) only mutates action-selection fields — so a same-tick
    // spawn's position is untouched by either system this tick (INV-SPAWN-1 stays
    // intact for the enemy's very first frame).
    const bounds = { width: 800, height: 600 };
    const world = makeWorld({
      bounds,
      spawner: { intervalRemainSec: 0, currentIntervalSec: 1.2 },
    });

    stepWorld(world, makeInputState(), DT, createRng(7));

    expect(world.enemies).toHaveLength(1);
    expect(world.enemies[0].alive).toBe(true);
    expect(world.enemies[0].x).toBe(bounds.width);
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

describe('stepWorld — healing items (issue #21: applyCombat now receives rng, prune filters healingItems)', () => {
  it('prunes healing items marked dead during the tick from world.healingItems', () => {
    const alreadyDead = makeHealingItem({ id: 60, alive: false });
    const world = makeWorld({
      healingItems: [alreadyDead],
      spawner: { intervalRemainSec: 999, currentIntervalSec: 999 },
    });

    stepWorld(world, makeInputState(), DT, createRng(1));

    expect(world.healingItems).toHaveLength(0);
  });

  it('does not consume the world/session in an unexpected way when applyCombat rolls the INV-ITEM-1 drop chance for a projectile kill', () => {
    // The signature-only concern here: stepWorld must actually pass its `rng` stream
    // through to applyCombat (step 7) without throwing, and any dropped item must end
    // up in world.healingItems and survive the end-of-tick prune while alive.
    const enemy = makeEnemy({ id: 61, hp: 1, x: 200, y: 300, width: 28, height: 28 });
    const projectile = makeRegularProjectile({
      id: 62,
      x: enemy.x,
      y: enemy.y,
      width: 8,
      height: 4,
      damage: 5,
    });
    const world = makeWorld({
      enemies: [enemy],
      regularProjectiles: [projectile],
      spawner: { intervalRemainSec: 999, currentIntervalSec: 999 },
    });

    expect(() => stepWorld(world, makeInputState(), DT, createRng(1))).not.toThrow();
    expect(world.enemies).toHaveLength(0);
    for (const item of world.healingItems) {
      expect(item.alive).toBe(true);
    }
  });

  it('reproduces identical world.healingItems for two runs given the same seed and input sequence (determinism, issue #21)', () => {
    function run(): { hp: number; healingItemCount: number } {
      const world = makeWorld({
        enemies: [makeEnemy({ id: 70, hp: 1, x: 150, y: 300, width: 28, height: 28 })],
        session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
        spawner: { intervalRemainSec: 999, currentIntervalSec: 999 },
      });
      const rng = createRng(99);
      for (let tick = 0; tick < 60; tick += 1) {
        stepWorld(world, makeInputState(), DT, rng);
      }
      return { hp: world.session.hp, healingItemCount: world.healingItems.length };
    }

    const runA = run();
    const runB = run();
    expect(runA).toEqual(runB);
  });

  // 2026-08-28 drift-removal revision — INV-ITEM-2 vs INV-ITEM-3 ordering.
  //
  // invariants.md's INV-ITEM-2 headline claims "획득이 수명 만료보다 우선한다" (pickup
  // takes priority over lifetime expiry), and `src/contracts/entities.ts`'s
  // `HealingItem.lifetimeRemainSec` JSDoc repeats the same claim ("a pickup in the same
  // tick removes the item regardless of the remaining value"). But INV-ITEM-2's own
  // worked-example paragraph, and the fixed System Execution Order in invariants.md §1
  // (`applyMovement` — step 3 — always runs before `detectCollisions` — step 6 — and
  // `applyCombat` — step 7), plus `detectCollisions`'s already-contracted behavior of
  // excluding dead items from `playerItemPickups` (see collision.test.ts "ignores a dead
  // healing item even when its AABB overlaps the player"), together describe the
  // opposite outcome for the exact tick where both conditions coincide: `applyMovement`
  // decrements `lifetimeRemainSec` to 0 and sets `alive = false` *before*
  // `detectCollisions` ever runs, so that tick's `detectCollisions` call sees an already-
  // dead item and never includes it in `playerItemPickups` — `applyCombat` then never
  // sees it, and INV-ITEM-3's heal/bonus-score effect cannot fire.
  //
  // These two tests pin down the actually-reachable, mechanically-consistent behavior
  // (expiry wins on the exact coinciding tick; pickup wins on every tick strictly before
  // expiry) rather than the self-contradictory headline. This contradiction was flagged
  // to the orchestrator/tech-leader for a contract clarification; frontend-qa cannot
  // resolve it unilaterally, so these tests encode the one behavior that is actually
  // producible by the documented, fixed `stepWorld` execution order.
  describe('healing item pickup vs. lifetime-expiry ordering (INV-ITEM-2 §1 execution order vs. INV-ITEM-3)', () => {
    function overlappingWorld(itemLifetimeRemainSec: number) {
      return makeWorld({
        player: makePlayer({ x: 200, y: 200, width: 32, height: 32 }),
        healingItems: [
          makeHealingItem({ id: 90, x: 200, y: 200, width: 20, height: 20, lifetimeRemainSec: itemLifetimeRemainSec }),
        ],
        spawner: { intervalRemainSec: 999, currentIntervalSec: 999 },
        session: { hp: 1, maxHp: 10, mana: 0, score: 0, level: 1, status: 'playing' },
      });
    }
    const neverCalledRng = (): number => {
      throw new Error('rng must not be called: no skill fire, no enemy spawn/AI/kill, no INV-ITEM-1 roll is expected this tick');
    };

    it('despawns without healing when lifetimeRemainSec reaches exactly 0 the same tick the player overlaps it', () => {
      const world = overlappingWorld(DT);
      stepWorld(world, makeInputState(), DT, neverCalledRng);
      expect(world.healingItems).toHaveLength(0);
      expect(world.session.hp).toBe(1);
      expect(world.session.score).toBe(0);
    });

    it('applies the normal INV-ITEM-3 pickup effect on the tick immediately before expiry would occur', () => {
      const world = overlappingWorld(DT * 1.5);
      stepWorld(world, makeInputState(), DT, neverCalledRng);
      expect(world.healingItems).toHaveLength(0);
      expect(world.session.hp).toBe(1 + BALANCE.healingItem.healAmount);
    });
  });
});
