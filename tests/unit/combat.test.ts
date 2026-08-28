// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CollisionResult, Rng } from '@/contracts';
import { BALANCE } from '@/game/balance';
import { applyCombat } from '@/game/systems/combat';
import {
  makeEnemy,
  makeEnemyProjectile,
  makeHealingItem,
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
    playerItemPickups: [],
  };
}

/**
 * A deterministic `Rng` that returns queued values in order and throws if called more
 * times than values were supplied (same pattern as `enemyAi.test.ts`'s `sequenceRng`,
 * duplicated here per the clean-room rule) — lets a test assert "consumes exactly N
 * rng calls" by supplying exactly N values, and "never consumes rng" by supplying `[]`.
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

/** A queued rng that also exposes how many values have actually been consumed so far. */
function countingSequenceRng(values: readonly number[]): { rng: Rng; callCount: () => number } {
  let cursor = 0;
  const rng: Rng = () => {
    if (cursor >= values.length) {
      throw new Error(`countingSequenceRng exhausted after ${cursor} call(s)`);
    }
    const value = values[cursor];
    cursor += 1;
    return value;
  };
  return { rng, callCount: () => cursor };
}

/** Never called; any invocation is a hard test failure (no rng consumption expected). */
const NO_RNG: Rng = () => {
  throw new Error('NO_RNG must never be called');
};

/** Guaranteed to be < BALANCE.healingItem.dropChance (drops an item). */
const DROP_RNG_VALUE = BALANCE.healingItem.dropChance / 2;
/** Guaranteed to be >= BALANCE.healingItem.dropChance (does not drop — strict `<` boundary). */
const NO_DROP_RNG_VALUE = BALANCE.healingItem.dropChance;
/** Comfortably above dropChance regardless of its exact value — never drops. */
const CLEARLY_NO_DROP_RNG_VALUE = 1;

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
        playerItemPickups: [],
      },
      DT,
      // No enemy dies this tick, so the INV-ITEM-1 drop roll must never run.
      NO_RNG,
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
        playerItemPickups: [],
      },
      DT,
      // The enemy dies here, so INV-ITEM-1 consumes exactly one rng call; use a value
      // that never drops so this test's only concern (score/mana) stays isolated.
      sequenceRng([CLEARLY_NO_DROP_RNG_VALUE]),
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
        playerItemPickups: [],
      },
      DT,
      sequenceRng([CLEARLY_NO_DROP_RNG_VALUE]),
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
        playerItemPickups: [],
      },
      DT,
      // The enemy dies exactly once, in the regular loop (regular runs first per
      // INV-ITEM-1's fixed order); the skill loop sees it already dead and must not
      // roll a second time. sequenceRng([one value]) throws if that assumption is
      // violated by a second rng() call.
      sequenceRng([CLEARLY_NO_DROP_RNG_VALUE]),
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
    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT, NO_RNG);
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
    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT, NO_RNG);
    expect(world.session.hp).toBe(3);
    expect(world.enemies[0].alive).toBe(false);
  });

  it('decrements invulnerability by dt at the start of combat, floored at 0', () => {
    const world = makeWorld({ player: makePlayer({ invulnRemainSec: DT / 2 }) });
    applyCombat(world, noCollisions(), DT, NO_RNG);
    expect(world.player.invulnRemainSec).toBe(0);
  });

  it('never lets HP drop below 0 from contact damage', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 5 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemies: [enemy],
      session: { hp: 1, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT, NO_RNG);
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
      applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT, NO_RNG);
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
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT, NO_RNG);
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
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT, NO_RNG);
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
      NO_RNG,
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
      NO_RNG,
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
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT, NO_RNG);
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
      NO_RNG,
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
    applyCombat(world, { ...noCollisions(), enemyProjectileHits: [{ projectile }] }, DT, NO_RNG);
    expect(world.player.invulnRemainSec).toBeCloseTo(BALANCE.player.invulnSec, 5);
  });
});

describe('applyCombat — healing item drop chance on projectile kills (INV-ITEM-1, issue #21)', () => {
  it('drops one healing item centered on the dead enemy when the roll is below dropChance (regular kill)', () => {
    const enemy = makeEnemy({ id: 1, hp: 1, x: 200, y: 150, width: 28, height: 28 });
    const projectile = makeRegularProjectile({ id: 2, damage: 1 });
    const world = makeWorld({ enemies: [enemy], regularProjectiles: [projectile] });

    applyCombat(
      world,
      {
        ...noCollisions(),
        regularProjectileHits: [{ enemy, projectile }],
      },
      DT,
      sequenceRng([DROP_RNG_VALUE]),
    );

    expect(world.enemies[0].alive).toBe(false);
    expect(world.healingItems).toHaveLength(1);
    const item = world.healingItems[0];
    expect(item.kind).toBe('healingItem');
    expect(item.alive).toBe(true);
    expect(item.x + item.width / 2).toBeCloseTo(enemy.x + enemy.width / 2, 8);
    expect(item.y + item.height / 2).toBeCloseTo(enemy.y + enemy.height / 2, 8);
    expect(item.vx).toBe(BALANCE.healingItem.driftVx);
    expect(item.vy).toBe(BALANCE.healingItem.fallVy);
  });

  it('does not drop a healing item when the roll lands exactly on dropChance (strict `<` boundary, regular kill)', () => {
    const enemy = makeEnemy({ id: 1, hp: 1 });
    const projectile = makeRegularProjectile({ id: 2, damage: 1 });
    const world = makeWorld({ enemies: [enemy], regularProjectiles: [projectile] });

    applyCombat(
      world,
      { ...noCollisions(), regularProjectileHits: [{ enemy, projectile }] },
      DT,
      sequenceRng([NO_DROP_RNG_VALUE]),
    );

    expect(world.enemies[0].alive).toBe(false);
    expect(world.healingItems).toHaveLength(0);
  });

  it('drops one healing item centered on the dead enemy when the roll is below dropChance (skill kill)', () => {
    const enemy = makeEnemy({ id: 1, hp: 1, x: 340, y: 210, width: 28, height: 28 });
    const projectile = makeSkillProjectile({ id: 3, damage: 1 });
    const world = makeWorld({ enemies: [enemy], skillProjectiles: [projectile] });

    applyCombat(
      world,
      { ...noCollisions(), skillProjectileHits: [{ enemy, projectile }] },
      DT,
      sequenceRng([DROP_RNG_VALUE]),
    );

    expect(world.enemies[0].alive).toBe(false);
    expect(world.healingItems).toHaveLength(1);
    const item = world.healingItems[0];
    expect(item.x + item.width / 2).toBeCloseTo(enemy.x + enemy.width / 2, 8);
    expect(item.y + item.height / 2).toBeCloseTo(enemy.y + enemy.height / 2, 8);
  });

  it('does not drop a healing item when the roll is not below dropChance (skill kill)', () => {
    const enemy = makeEnemy({ id: 1, hp: 1 });
    const projectile = makeSkillProjectile({ id: 3, damage: 1 });
    const world = makeWorld({ enemies: [enemy], skillProjectiles: [projectile] });

    applyCombat(
      world,
      { ...noCollisions(), skillProjectileHits: [{ enemy, projectile }] },
      DT,
      sequenceRng([CLEARLY_NO_DROP_RNG_VALUE]),
    );

    expect(world.enemies[0].alive).toBe(false);
    expect(world.healingItems).toHaveLength(0);
  });

  it('never rolls for a healing item drop on a contact-kill (only projectile kills roll, per INV-ITEM-1)', () => {
    const enemy = makeEnemy({ id: 1, contactDamage: 1 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: 0 }),
      enemies: [enemy],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    applyCombat(world, { ...noCollisions(), playerContacts: [{ enemy }] }, DT, NO_RNG);

    expect(world.enemies[0].alive).toBe(false);
    expect(world.healingItems).toHaveLength(0);
  });

  it('rolls regular kills fully before skill kills, exactly once per death, in that fixed order', () => {
    const regularEnemyA = makeEnemy({ id: 10, hp: 1, x: 100, y: 100, width: 28, height: 28 });
    const regularEnemyB = makeEnemy({ id: 11, hp: 1, x: 200, y: 100, width: 28, height: 28 });
    const skillEnemyC = makeEnemy({ id: 12, hp: 1, x: 300, y: 100, width: 28, height: 28 });
    const regularProjectileA = makeRegularProjectile({ id: 20, damage: 1 });
    const regularProjectileB = makeRegularProjectile({ id: 21, damage: 1 });
    const skillProjectileC = makeSkillProjectile({ id: 22, damage: 1 });
    const world = makeWorld({
      enemies: [regularEnemyA, regularEnemyB, skillEnemyC],
      regularProjectiles: [regularProjectileA, regularProjectileB],
      skillProjectiles: [skillProjectileC],
    });

    const { rng, callCount } = countingSequenceRng([
      DROP_RNG_VALUE, // regularEnemyA -> drop
      CLEARLY_NO_DROP_RNG_VALUE, // regularEnemyB -> no drop
      DROP_RNG_VALUE, // skillEnemyC -> drop
    ]);

    applyCombat(
      world,
      {
        ...noCollisions(),
        regularProjectileHits: [
          { enemy: regularEnemyA, projectile: regularProjectileA },
          { enemy: regularEnemyB, projectile: regularProjectileB },
        ],
        skillProjectileHits: [{ enemy: skillEnemyC, projectile: skillProjectileC }],
      },
      DT,
      rng,
    );

    expect(callCount()).toBe(3);
    expect(world.healingItems).toHaveLength(2);
    const centers = world.healingItems.map((item) => ({
      x: item.x + item.width / 2,
      y: item.y + item.height / 2,
    }));
    expect(centers).toContainEqual({
      x: regularEnemyA.x + regularEnemyA.width / 2,
      y: regularEnemyA.y + regularEnemyA.height / 2,
    });
    expect(centers).toContainEqual({
      x: skillEnemyC.x + skillEnemyC.width / 2,
      y: skillEnemyC.y + skillEnemyC.height / 2,
    });
  });
});

describe('applyCombat — healing item pickup: heal or full-HP bonus score (INV-ITEM-3, issue #21)', () => {
  it('restores HP by healAmount, capped at maxHp, and consumes rng zero times', () => {
    const item = makeHealingItem({ id: 40, alive: true });
    const world = makeWorld({
      healingItems: [item],
      session: { hp: 1, maxHp: 10, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    applyCombat(world, { ...noCollisions(), playerItemPickups: [{ item }] }, DT, NO_RNG);

    expect(world.session.hp).toBe(Math.min(10, 1 + BALANCE.healingItem.healAmount));
    expect(world.session.score).toBe(0);
    expect(world.healingItems[0].alive).toBe(false);
  });

  it('caps the HP restore at maxHp instead of overflowing it', () => {
    const item = makeHealingItem({ id: 41, alive: true });
    const startHp = Math.max(1, BALANCE.player.maxHp - 1);
    const maxHp = startHp + 1;
    const world = makeWorld({
      healingItems: [item],
      session: { hp: startHp, maxHp, mana: 0, score: 0, level: 1, status: 'playing' },
    });

    applyCombat(world, { ...noCollisions(), playerItemPickups: [{ item }] }, DT, NO_RNG);

    expect(world.session.hp).toBe(maxHp);
    expect(world.session.hp).toBeLessThanOrEqual(maxHp);
  });

  it('grants fullHpBonusScore instead of HP when already at maxHp, and consumes rng zero times', () => {
    const item = makeHealingItem({ id: 42, alive: true });
    const world = makeWorld({
      healingItems: [item],
      session: { hp: 5, maxHp: 5, mana: 0, score: 100, level: 1, status: 'playing' },
    });

    applyCombat(world, { ...noCollisions(), playerItemPickups: [{ item }] }, DT, NO_RNG);

    expect(world.session.hp).toBe(5);
    expect(world.session.score).toBe(100 + BALANCE.healingItem.fullHpBonusScore);
    expect(world.healingItems[0].alive).toBe(false);
  });

  it('never touches mana on pickup, regardless of heal or bonus-score outcome', () => {
    const healItem = makeHealingItem({ id: 43, alive: true });
    const healWorld = makeWorld({
      healingItems: [healItem],
      session: { hp: 1, maxHp: 10, mana: 42, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(healWorld, { ...noCollisions(), playerItemPickups: [{ item: healItem }] }, DT, NO_RNG);
    expect(healWorld.session.mana).toBe(42);

    const bonusItem = makeHealingItem({ id: 44, alive: true });
    const bonusWorld = makeWorld({
      healingItems: [bonusItem],
      session: { hp: 5, maxHp: 5, mana: 42, score: 0, level: 1, status: 'playing' },
    });
    applyCombat(bonusWorld, { ...noCollisions(), playerItemPickups: [{ item: bonusItem }] }, DT, NO_RNG);
    expect(bonusWorld.session.mana).toBe(42);
  });
});
