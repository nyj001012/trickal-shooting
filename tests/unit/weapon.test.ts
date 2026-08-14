// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RegularProjectile, SkillProjectile } from '@/contracts';
import { BALANCE } from '@/game/balance';
import { fireWeapon } from '@/game/systems/weapon';
import { makeInputState, makePlayer, makeWorld } from '../helpers/fixtures';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

describe('fireWeapon — regular automatic fire (INV-FIRE-1)', () => {
  it('fires from the player right-edge center on the first tick and regenerates mana', () => {
    const world = makeWorld({
      player: makePlayer({ x: 100, y: 200, regularFireCooldownRemainSec: 0 }),
      session: { hp: 3, maxHp: 3, mana: 10, score: 0, level: 1, status: 'playing' },
    });

    fireWeapon(world, makeInputState(), DT);

    expect(world.regularProjectiles).toHaveLength(1);
    expect(world.skillProjectiles).toHaveLength(0);
    expect(world.regularProjectiles[0]).toMatchObject({
      kind: 'regularProjectile',
      x: 100 + world.player.width,
      y: 200 + world.player.height / 2 - BALANCE.regularProjectile.height / 2,
      damage: BALANCE.regularProjectile.damage,
      lifetimeRemainSec: BALANCE.regularProjectile.lifetimeSec,
    });
    expect(world.session.mana).toBeCloseTo(10 + BALANCE.player.manaRegenPerSec * DT, 8);
    expect(world.player.regularFireCooldownRemainSec).toBe(BALANCE.player.regularFireCooldownSec);
  });

  it('does not fire while the regular cooldown remains positive, but decrements both cooldowns', () => {
    const world = makeWorld({
      player: makePlayer({
        regularFireCooldownRemainSec: 0.2,
        skillFireCooldownRemainSec: 0.1,
      }),
    });
    fireWeapon(world, makeInputState(), DT);
    expect(world.regularProjectiles).toHaveLength(0);
    expect(world.player.regularFireCooldownRemainSec).toBeCloseTo(0.2 - DT, 8);
    expect(world.player.skillFireCooldownRemainSec).toBeCloseTo(0.1 - DT, 8);
  });

  it('fires again after exactly 0.3 seconds without input', () => {
    expect(BALANCE.player.regularFireCooldownSec).toBe(0.3);
    const world = makeWorld();

    fireWeapon(world, makeInputState(), DT);
    const ticksPerCooldown = Math.round(BALANCE.player.regularFireCooldownSec / DT);
    for (let i = 0; i < ticksPerCooldown - 1; i += 1) {
      fireWeapon(world, makeInputState(), DT);
    }
    expect(world.regularProjectiles).toHaveLength(1);

    fireWeapon(world, makeInputState(), DT);
    expect(world.regularProjectiles).toHaveLength(2);
  });

  it('saturates passive mana regeneration at 100', () => {
    const world = makeWorld({
      player: makePlayer({ regularFireCooldownRemainSec: 1 }),
      session: { hp: 3, maxHp: 3, mana: 100, score: 0, level: 1, status: 'playing' },
    });
    fireWeapon(world, makeInputState(), DT);
    expect(world.session.mana).toBe(100);
  });
});

describe('fireWeapon — Space skill mode and mutual exclusion', () => {
  it('starts at 20 mana, drains mana, and fires only a skill projectile', () => {
    const world = makeWorld({
      player: makePlayer({ regularFireCooldownRemainSec: 0, skillFireCooldownRemainSec: 0 }),
      session: {
        hp: 3,
        maxHp: 3,
        mana: BALANCE.player.skillStartMana,
        score: 0,
        level: 1,
        status: 'playing',
      },
    });

    fireWeapon(world, makeInputState({ skill: true }), DT);

    expect(world.player.isSkillFiring).toBe(true);
    expect(world.regularProjectiles).toHaveLength(0);
    expect(world.skillProjectiles).toHaveLength(1);
    expect(world.skillProjectiles[0]).toMatchObject({
      kind: 'skillProjectile',
      x: world.player.x + world.player.width,
      y: world.player.y + world.player.height / 2 - BALANCE.skillProjectile.height / 2,
      vx: BALANCE.skillProjectile.speed,
      vy: 0,
    });
    expect(world.session.mana).toBeCloseTo(
      BALANCE.player.skillStartMana - BALANCE.player.skillManaDrainPerSec * DT,
      8,
    );
  });

  it('does not start below 20 mana and continues regular fire instead', () => {
    const world = makeWorld({
      session: {
        hp: 3,
        maxHp: 3,
        mana: BALANCE.player.skillStartMana - 1,
        score: 0,
        level: 1,
        status: 'playing',
      },
    });
    fireWeapon(world, makeInputState({ skill: true }), DT);
    expect(world.player.isSkillFiring).toBe(false);
    expect(world.regularProjectiles).toHaveLength(1);
    expect(world.skillProjectiles).toHaveLength(0);
  });

  it('keeps firing the skill below the start threshold once the mode has started', () => {
    const world = makeWorld({
      player: makePlayer({ isSkillFiring: true, skillFireCooldownRemainSec: 0 }),
      session: { hp: 3, maxHp: 3, mana: 10, score: 0, level: 1, status: 'playing' },
    });
    fireWeapon(world, makeInputState({ skill: true }), DT);
    expect(world.player.isSkillFiring).toBe(true);
    expect(world.skillProjectiles).toHaveLength(1);
    expect(world.regularProjectiles).toHaveLength(0);
  });

  it('releases back to regular auto-fire in the same tick when Space is released', () => {
    const world = makeWorld({
      player: makePlayer({
        isSkillFiring: true,
        regularFireCooldownRemainSec: 0,
        skillFireCooldownRemainSec: 0,
      }),
      session: { hp: 3, maxHp: 3, mana: 10, score: 0, level: 1, status: 'playing' },
    });
    fireWeapon(world, makeInputState({ skill: false }), DT);
    expect(world.player.isSkillFiring).toBe(false);
    expect(world.regularProjectiles).toHaveLength(1);
    expect(world.skillProjectiles).toHaveLength(0);
    expect(world.session.mana).toBeGreaterThan(10);
  });

  it('uses the final mana on a skill-only tick, then disables the mode for the next tick', () => {
    const world = makeWorld({
      player: makePlayer({
        isSkillFiring: true,
        regularFireCooldownRemainSec: 0,
        skillFireCooldownRemainSec: 0,
      }),
      session: { hp: 3, maxHp: 3, mana: 0.25, score: 0, level: 1, status: 'playing' },
    });
    fireWeapon(world, makeInputState({ skill: true }), DT);
    expect(world.session.mana).toBe(0);
    expect(world.player.isSkillFiring).toBe(false);
    expect(world.skillProjectiles).toHaveLength(1);
    expect(world.regularProjectiles).toHaveLength(0);
  });

  it('fires skill projectiles at the independent 0.15 second interval', () => {
    expect(BALANCE.player.skillFireCooldownSec).toBe(0.15);
    const world = makeWorld({
      player: makePlayer({ isSkillFiring: true }),
      session: { hp: 3, maxHp: 3, mana: 100, score: 0, level: 1, status: 'playing' },
    });
    fireWeapon(world, makeInputState({ skill: true }), DT);
    const ticksPerCooldown = Math.round(BALANCE.player.skillFireCooldownSec / DT);
    for (let i = 0; i < ticksPerCooldown - 1; i += 1) {
      fireWeapon(world, makeInputState({ skill: true }), DT);
    }
    expect(world.skillProjectiles).toHaveLength(1);
    fireWeapon(world, makeInputState({ skill: true }), DT);
    expect(world.skillProjectiles).toHaveLength(2);
  });
});

describe('fireWeapon — independent projectile caps', () => {
  it('skips a regular shot at its cap without affecting the skill array', () => {
    const existing: RegularProjectile[] = Array.from(
      { length: BALANCE.limits.maxRegularProjectiles },
      (_unused, id) => ({
        id,
        kind: 'regularProjectile',
        x: 0,
        y: 0,
        width: BALANCE.regularProjectile.width,
        height: BALANCE.regularProjectile.height,
        alive: true,
        damage: BALANCE.regularProjectile.damage,
        lifetimeRemainSec: BALANCE.regularProjectile.lifetimeSec,
      }),
    );
    const world = makeWorld({ regularProjectiles: existing, nextEntityId: existing.length });
    fireWeapon(world, makeInputState(), DT);
    expect(world.regularProjectiles).toHaveLength(BALANCE.limits.maxRegularProjectiles);
    expect(world.skillProjectiles).toHaveLength(0);
    expect(world.nextEntityId).toBe(existing.length);
  });

  it('skips a skill shot at its cap without affecting the regular array', () => {
    const existing: SkillProjectile[] = Array.from(
      { length: BALANCE.limits.maxSkillProjectiles },
      (_unused, id) => ({
        id,
        kind: 'skillProjectile',
        x: 0,
        y: 0,
        width: BALANCE.skillProjectile.width,
        height: BALANCE.skillProjectile.height,
        alive: true,
        damage: BALANCE.skillProjectile.damage,
        lifetimeRemainSec: BALANCE.skillProjectile.lifetimeSec,
        vx: BALANCE.skillProjectile.speed,
        vy: 0,
      }),
    );
    const world = makeWorld({
      player: makePlayer({ isSkillFiring: true }),
      skillProjectiles: existing,
      session: { hp: 3, maxHp: 3, mana: 100, score: 0, level: 1, status: 'playing' },
      nextEntityId: existing.length,
    });
    fireWeapon(world, makeInputState({ skill: true }), DT);
    expect(world.skillProjectiles).toHaveLength(BALANCE.limits.maxSkillProjectiles);
    expect(world.regularProjectiles).toHaveLength(0);
    expect(world.nextEntityId).toBe(existing.length);
  });
});
