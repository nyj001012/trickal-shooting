// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyCombat } from '@/game/systems/combat';
import { BALANCE } from '@/game/balance';
import { makeEnemy, makePlayer, makeProjectile, makeWorld } from '../helpers/fixtures';
import type { CollisionResult } from '@/contracts';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

function noCollisions(): CollisionResult {
  return { projectileHits: [], playerContacts: [] };
}

describe('applyCombat — projectile hits (D-3 score/mana)', () => {
  it('reduces the enemy hp by the projectile damage and kills the projectile, without granting score/mana yet', () => {
    const enemy = makeEnemy({ id: 1, hp: 5 });
    const projectile = makeProjectile({ id: 2, damage: 2 });
    const world = makeWorld({ enemies: [enemy], projectiles: [projectile] });
    applyCombat(world, { projectileHits: [{ enemy, projectile }], playerContacts: [] }, DT);
    expect(world.enemies[0].hp).toBe(3);
    expect(world.enemies[0].alive).toBe(true);
    expect(world.projectiles[0].alive).toBe(false);
    expect(world.session.score).toBe(0);
    expect(world.session.mana).toBe(0);
  });

  it('kills the enemy and grants its scoreValue/manaGain once hp drops to 0 or below', () => {
    const enemy = makeEnemy({ id: 1, hp: 1, scoreValue: 10, manaGain: 5 });
    const projectile = makeProjectile({ id: 2, damage: 1 });
    const world = makeWorld({
      enemies: [enemy],
      projectiles: [projectile],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { projectileHits: [{ enemy, projectile }], playerContacts: [] }, DT);
    expect(world.enemies[0].alive).toBe(false);
    expect(world.session.score).toBe(10);
    expect(world.session.mana).toBe(5);
  });
});

describe('applyCombat — player contact damage (INV-DMG-1)', () => {
  it('reduces HP by contactDamage, removes the enemy, and starts the invulnerability window when not already invulnerable', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { projectileHits: [], playerContacts: [{ enemy }] }, DT);
    expect(world.session.hp).toBe(2);
    expect(world.enemies[0].alive).toBe(false);
    expect(world.player.invulnRemainSec).toBeCloseTo(BALANCE.player.invulnSec, 5);
  });

  it('does NOT reduce HP for a contact arriving while still invulnerable, but still removes the contacting enemy', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: BALANCE.player.invulnSec }),
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { projectileHits: [], playerContacts: [{ enemy }] }, DT);
    expect(world.session.hp).toBe(3);
    expect(world.enemies[0].alive).toBe(false);
  });

  it('decrements invulnRemainSec by dt at the start of combat, floored at 0', () => {
    const world = makeWorld({ player: makePlayer({ invulnRemainSec: DT / 2 }) });
    applyCombat(world, noCollisions(), DT);
    expect(world.player.invulnRemainSec).toBe(0);
  });

  it('never lets HP drop below 0 from contact damage', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 5 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemies: [enemy],
      session: { hp: 1, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { projectileHits: [], playerContacts: [{ enemy }] }, DT);
    expect(world.session.hp).toBe(0);
  });

  it('INV-DMG-1: across many contacts inside one invulnerability window, total HP loss from contact damage is at most 1', () => {
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      session: { hp: 5, maxHp: 5, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    const startHp = world.session.hp;
    // Simulate a swarm: a new contacting enemy arrives every tick, for as many
    // ticks as safely fit inside the invulnSec window granted by the first hit.
    const ticksInsideWindow = Math.max(2, Math.floor(BALANCE.player.invulnSec / DT));
    for (let i = 0; i < ticksInsideWindow; i += 1) {
      const enemy = makeEnemy({ id: 100 + i, contactDamage: 1, alive: true });
      applyCombat(world, { projectileHits: [], playerContacts: [{ enemy }] }, DT);
    }
    expect(startHp - world.session.hp).toBeLessThanOrEqual(1);
  });
});
