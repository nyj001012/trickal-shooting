// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CollisionResult } from '@/contracts';
import { BALANCE } from '@/game/balance';
import { applyCombat } from '@/game/systems/combat';
import {
  makeEnemy,
  makeEnemyProjectile,
  makePlayer,
  makeRegularProjectile,
  makeSkillProjectile,
  makeWorld,
} from '../helpers/fixtures';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

function noCollisions(): CollisionResult {
  return {
    regularProjectileHits: [],
    skillProjectileHits: [],
    playerContacts: [],
    enemyProjectileHits: [],
  };
}

describe('applyCombat — separated regular and skill projectile rewards', () => {
  it('applies regular damage and consumes the projectile without an early reward', () => {
    const enemy = makeEnemy({ id: 1, hp: 5 });
    const projectile = makeRegularProjectile({ id: 2, damage: 2 });
    const world = makeWorld({ enemies: [enemy], regularProjectiles: [projectile] });
    applyCombat(
      world,
      {
        regularProjectileHits: [{ enemy, projectile }],
        skillProjectileHits: [],
        playerContacts: [],
        enemyProjectileHits: [],
      },
      DT,
    );
    expect(world.enemies[0].hp).toBe(3);
    expect(world.enemies[0].alive).toBe(true);
    expect(world.regularProjectiles[0].alive).toBe(false);
    expect(world.session.score).toBe(0);
    expect(world.session.mana).toBe(0);
  });

  it('grants score and capped mana when a regular projectile kills an enemy', () => {
    const enemy = makeEnemy({ id: 1, hp: 1, scoreValue: 10, manaGain: 5 });
    const projectile = makeRegularProjectile({ id: 2, damage: 1 });
    const world = makeWorld({
      enemies: [enemy],
      regularProjectiles: [projectile],
      session: { hp: 3, maxHp: 3, mana: 99, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(
      world,
      {
        regularProjectileHits: [{ enemy, projectile }],
        skillProjectileHits: [],
        playerContacts: [],
        enemyProjectileHits: [],
      },
      DT,
    );
    expect(world.enemies[0].alive).toBe(false);
    expect(world.session.score).toBe(10);
    expect(world.session.mana).toBe(BALANCE.progression.manaMax);
  });

  it('grants score but no mana when a skill projectile kills an enemy', () => {
    const enemy = makeEnemy({ id: 1, hp: 1, scoreValue: 10, manaGain: 5 });
    const projectile = makeSkillProjectile({ id: 3, damage: 1 });
    const world = makeWorld({
      enemies: [enemy],
      skillProjectiles: [projectile],
      session: { hp: 3, maxHp: 3, mana: 40, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(
      world,
      {
        regularProjectileHits: [],
        skillProjectileHits: [{ enemy, projectile }],
        playerContacts: [],
        enemyProjectileHits: [],
      },
      DT,
    );
    expect(world.enemies[0].alive).toBe(false);
    expect(world.session.score).toBe(10);
    expect(world.session.mana).toBe(40);
  });

  it('does not double-reward one enemy hit by both projectile lists in the same tick', () => {
    const enemy = makeEnemy({ id: 1, hp: 1, scoreValue: 10, manaGain: 5 });
    const regular = makeRegularProjectile({ id: 2 });
    const skill = makeSkillProjectile({ id: 3 });
    const world = makeWorld({
      enemies: [enemy],
      regularProjectiles: [regular],
      skillProjectiles: [skill],
    });
    applyCombat(
      world,
      {
        regularProjectileHits: [{ enemy, projectile: regular }],
        skillProjectileHits: [{ enemy, projectile: skill }],
        playerContacts: [],
        enemyProjectileHits: [],
      },
      DT,
    );
    expect(world.session.score).toBe(10);
    expect(world.session.mana).toBe(5);
    expect(world.regularProjectiles[0].alive).toBe(false);
    expect(world.skillProjectiles[0].alive).toBe(true);
  });
});

describe('applyCombat — player contact damage (INV-DMG-1)', () => {
  it('reduces HP, removes the enemy, and starts invulnerability when vulnerable', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT);
    expect(world.session.hp).toBe(2);
    expect(world.enemies[0].alive).toBe(false);
    expect(world.player.invulnRemainSec).toBeCloseTo(BALANCE.player.invulnSec, 5);
  });

  it('does not reduce HP while invulnerable, but still removes the contacting enemy', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: BALANCE.player.invulnSec }),
      enemies: [enemy],
    });
    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT);
    expect(world.session.hp).toBe(3);
    expect(world.enemies[0].alive).toBe(false);
  });

  it('decrements invulnerability by dt at the start of combat, floored at 0', () => {
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
    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT);
    expect(world.session.hp).toBe(0);
  });

  it('allows at most one HP loss inside an invulnerability window', () => {
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      session: { hp: 5, maxHp: 5, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    const startHp = world.session.hp;
    const ticksInsideWindow = Math.max(2, Math.floor(BALANCE.player.invulnSec / DT));
    for (let i = 0; i < ticksInsideWindow; i += 1) {
      const enemy = makeEnemy({ id: 100 + i, contactDamage: 1 });
      applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT);
    }
    expect(startHp - world.session.hp).toBeLessThanOrEqual(1);
  });
});

describe('applyCombat — enemy projectile hits share the contact invulnerability window (INV-EPROJ-4, issue #17)', () => {
  it('reduces HP by the projectile damage, consumes it, and starts invulnerability when vulnerable', () => {
    const projectile = makeEnemyProjectile({ id: 20, damage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemyProjectiles: [projectile],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT);
    expect(world.session.hp).toBe(2);
    expect(world.enemyProjectiles[0].alive).toBe(false);
    expect(world.player.invulnRemainSec).toBeCloseTo(BALANCE.player.invulnSec, 5);
  });

  it('does not reduce HP from an enemy projectile hit while invulnerable, but still consumes the projectile', () => {
    const projectile = makeEnemyProjectile({ id: 21, damage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: BALANCE.player.invulnSec }),
      enemyProjectiles: [projectile],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT);
    expect(world.session.hp).toBe(3);
    expect(world.enemyProjectiles[0].alive).toBe(false);
  });

  it('always marks a hitting enemy projectile dead regardless of invulnerability', () => {
    const vulnerable = makeEnemyProjectile({ id: 22, damage: 1 });
    const worldVulnerable = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemyProjectiles: [vulnerable],
    });
    applyCombat(
      worldVulnerable,
      { ...noCollisions(), enemyProjectileHits: [{ projectile: vulnerable }] },
      DT,
    );
    expect(worldVulnerable.enemyProjectiles[0].alive).toBe(false);

    const invulnerable = makeEnemyProjectile({ id: 23, damage: 1 });
    const worldInvulnerable = makeWorld({
      player: makePlayer({ invulnRemainSec: BALANCE.player.invulnSec }),
      enemyProjectiles: [invulnerable],
    });
    applyCombat(
      worldInvulnerable,
      { ...noCollisions(), enemyProjectileHits: [{ projectile: invulnerable }] },
      DT,
    );
    expect(worldInvulnerable.enemyProjectiles[0].alive).toBe(false);
  });

  it('never lets HP drop below 0 from an enemy projectile hit', () => {
    const projectile = makeEnemyProjectile({ id: 24, damage: 5 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemyProjectiles: [projectile],
      session: { hp: 1, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT);
    expect(world.session.hp).toBe(0);
  });

  it('does not stack HP loss when a contact and an enemy projectile hit land in the same tick (INV-EPROJ-4)', () => {
    const enemy = makeEnemy({ id: 30, contactDamage: 1 });
    const projectile = makeEnemyProjectile({ id: 31, damage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemies: [enemy],
      enemyProjectiles: [projectile],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(
      world,
      { ...noCollisions(), playerContacts: [{ enemy }], enemyProjectileHits: [{ projectile }] },
      DT,
    );
    // Contact (step 4) runs before the enemy-projectile hit (step 5) and already
    // resets invulnRemainSec, so the projectile hit landing the same tick must not
    // cause a second HP loss.
    expect(world.session.hp).toBe(2);
    expect(world.enemies[0].alive).toBe(false);
    expect(world.enemyProjectiles[0].alive).toBe(false);
    expect(world.player.invulnRemainSec).toBeCloseTo(BALANCE.player.invulnSec, 5);
  });

  it('resets invulnRemainSec to BALANCE.player.invulnSec after a vulnerable enemy projectile hit', () => {
    const projectile = makeEnemyProjectile({ id: 32, damage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemyProjectiles: [projectile],
    });
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT);
    expect(world.player.invulnRemainSec).toBeCloseTo(BALANCE.player.invulnSec, 5);
  });
});
