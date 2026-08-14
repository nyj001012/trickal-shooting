// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyMovement } from '@/game/systems/movement';
import { BALANCE } from '@/game/balance';
import {
  makeEnemy,
  makeInputState,
  makePlayer,
  makeRegularProjectile,
  makeSkillProjectile,
  makeWorld,
} from '../helpers/fixtures';
import type { InputState } from '@/contracts';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

describe('applyMovement — player diagonal speed normalization (INV-MOVE-1)', () => {
  it('moves the same Euclidean distance for a diagonal input as for a single-axis input', () => {
    const straight = makeWorld({ player: makePlayer({ x: 400, y: 300 }) });
    applyMovement(straight, makeInputState({ right: true }), DT);
    const straightDist = Math.hypot(straight.player.x - 400, straight.player.y - 300);

    const diagonal = makeWorld({ player: makePlayer({ x: 400, y: 300 }) });
    applyMovement(diagonal, makeInputState({ right: true, down: true }), DT);
    const diagonalDist = Math.hypot(diagonal.player.x - 400, diagonal.player.y - 300);

    expect(diagonalDist).toBeCloseTo(straightDist, 5);
    expect(diagonalDist).toBeCloseTo(BALANCE.player.speed * DT, 5);
    // Must not be the classic sqrt(2) bug: the diagonal x-delta must shrink
    // relative to the straight-line x-delta (not stay equal / not sum to more).
    expect(Math.abs(diagonal.player.x - 400)).toBeLessThan(Math.abs(straight.player.x - 400));
  });

  it('cancels to zero net movement when opposite directions are held simultaneously', () => {
    const world = makeWorld({ player: makePlayer({ x: 400, y: 300 }) });
    applyMovement(world, makeInputState({ left: true, right: true, up: true, down: true }), DT);
    expect(world.player.x).toBe(400);
    expect(world.player.y).toBe(300);
  });

  it('never exceeds speed * dt of Euclidean movement for any of the 8 held directions', () => {
    const combos: Partial<InputState>[] = [
      { up: true },
      { down: true },
      { left: true },
      { right: true },
      { up: true, left: true },
      { up: true, right: true },
      { down: true, left: true },
      { down: true, right: true },
    ];
    for (const combo of combos) {
      const world = makeWorld({ player: makePlayer({ x: 400, y: 300 }) });
      applyMovement(world, makeInputState(combo), DT);
      const dist = Math.hypot(world.player.x - 400, world.player.y - 300);
      expect(dist).toBeLessThanOrEqual(BALANCE.player.speed * DT + 1e-9);
    }
  });
});

describe('applyMovement — player boundary clamp (INV-MOVE-2)', () => {
  it('clamps x/y back inside bounds even with zero movement input (defensive clamp every tick)', () => {
    const bounds = { width: 800, height: 600 };
    const width = 32;
    const height = 32;

    const beyondRight = makeWorld({
      bounds,
      player: makePlayer({ x: 900, y: 300, width, height }),
    });
    applyMovement(beyondRight, makeInputState(), DT);
    expect(beyondRight.player.x).toBe(bounds.width - width);

    const beyondLeft = makeWorld({ bounds, player: makePlayer({ x: -50, y: 300, width, height }) });
    applyMovement(beyondLeft, makeInputState(), DT);
    expect(beyondLeft.player.x).toBe(0);

    const beyondBottom = makeWorld({
      bounds,
      player: makePlayer({ x: 400, y: 900, width, height }),
    });
    applyMovement(beyondBottom, makeInputState(), DT);
    expect(beyondBottom.player.y).toBe(bounds.height - height);

    const beyondTop = makeWorld({ bounds, player: makePlayer({ x: 400, y: -50, width, height }) });
    applyMovement(beyondTop, makeInputState(), DT);
    expect(beyondTop.player.y).toBe(0);
  });

  it('clamps within the same tick after applying movement (moving further into the wall stays clamped)', () => {
    const bounds = { width: 800, height: 600 };
    const width = 32;
    const world = makeWorld({
      bounds,
      player: makePlayer({ x: bounds.width - width, y: 300, width, height: width }),
    });
    applyMovement(world, makeInputState({ right: true }), DT);
    expect(world.player.x).toBe(bounds.width - width);
  });
});

describe('applyMovement — enemies move left and disappear without damaging the player (D-5, INV-ESCAPE-1)', () => {
  it('moves every alive enemy left by speed * dt', () => {
    const enemy = makeEnemy({ x: 400, y: 300 });
    const world = makeWorld({ enemies: [enemy] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemies[0].x).toBeCloseTo(400 - BALANCE.enemy.speed * DT, 5);
  });

  it('does not move a dead enemy', () => {
    const enemy = makeEnemy({ x: 400, y: 300, alive: false });
    const world = makeWorld({ enemies: [enemy] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemies[0].x).toBe(400);
  });

  it('marks an enemy dead without changing session or invulnerability once its right edge crosses the left screen edge', () => {
    const escaping = makeEnemy({ x: -1000, width: 28 }); // already far past the left edge
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: BALANCE.player.invulnSec / 2 }),
      enemies: [escaping],
      session: { hp: 2, maxHp: 3, mana: 15, score: 40, level: 2, status: 'playing' },
    });
    const sessionBefore = { ...world.session };
    const invulnBefore = world.player.invulnRemainSec;

    applyMovement(world, makeInputState(), DT);

    expect(world.enemies[0].alive).toBe(false);
    expect(world.session).toEqual(sessionBefore);
    expect(world.player.invulnRemainSec).toBe(invulnBefore);
  });

  it('keeps an enemy alive while its right edge is exactly on the left boundary', () => {
    const width = 28;
    const atBoundaryAfterMovement = makeEnemy({
      x: -width + BALANCE.enemy.speed * DT,
      width,
    });
    const world = makeWorld({ enemies: [atBoundaryAfterMovement] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemies[0].x + world.enemies[0].width).toBeCloseTo(0, 10);
    expect(world.enemies[0].alive).toBe(true);
  });
});

describe('applyMovement — regular projectiles (D-2)', () => {
  it('moves alive regular projectiles right and decrements lifetime', () => {
    const projectile = makeRegularProjectile({ x: 100, y: 300, lifetimeRemainSec: 2 });
    const world = makeWorld({ regularProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.regularProjectiles[0].x).toBeCloseTo(
      100 + BALANCE.regularProjectile.speed * DT,
      5,
    );
    expect(world.regularProjectiles[0].lifetimeRemainSec).toBeCloseTo(2 - DT, 5);
  });

  it('marks a regular projectile dead on lifetime expiry or right-edge exit', () => {
    const projectile = makeRegularProjectile({
      x: 801,
      y: 300,
      lifetimeRemainSec: DT / 2,
    });
    const world = makeWorld({ regularProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.regularProjectiles[0].alive).toBe(false);
  });
});

describe('applyMovement — skill-projectile homing and expiry (D-2)', () => {
  it('homes toward the nearest alive enemy at the configured speed', () => {
    const projectile = makeSkillProjectile({ x: 100, y: 100, vx: 0, vy: 0 });
    const farther = makeEnemy({ id: 1, x: 400, y: 400 });
    const nearer = makeEnemy({ id: 2, x: 200, y: 120 });
    const world = makeWorld({ enemies: [farther, nearer], skillProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);

    const moved = world.skillProjectiles[0];
    expect(Math.hypot(moved.vx, moved.vy)).toBeCloseTo(BALANCE.skillProjectile.speed, 5);
    expect(moved.vx).toBeGreaterThan(0);
    expect(moved.vy).toBeGreaterThan(0);
    expect(moved.x).toBeCloseTo(100 + moved.vx * DT, 5);
    expect(moved.y).toBeCloseTo(100 + moved.vy * DT, 5);
  });

  it('uses the first enemy in array order when nearest distances are tied', () => {
    const projectile = makeSkillProjectile({ x: 100, y: 100, vx: 0, vy: 0 });
    const first = makeEnemy({ id: 1, x: 250, y: 68 });
    const second = makeEnemy({ id: 2, x: 250, y: 124 });
    const world = makeWorld({ enemies: [first, second], skillProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.skillProjectiles[0].vy).toBeLessThan(0);
  });

  it('travels straight right when no alive target exists', () => {
    const projectile = makeSkillProjectile({ x: 100, y: 100, vx: 0, vy: 99 });
    const world = makeWorld({
      enemies: [makeEnemy({ alive: false })],
      skillProjectiles: [projectile],
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.skillProjectiles[0].vx).toBe(BALANCE.skillProjectile.speed);
    expect(world.skillProjectiles[0].vy).toBe(0);
    expect(world.skillProjectiles[0].x).toBeCloseTo(100 + BALANCE.skillProjectile.speed * DT, 5);
  });

  it('expires a skill projectile by lifetime or after fully crossing any playfield edge', () => {
    const expired = makeSkillProjectile({ lifetimeRemainSec: DT / 2 });
    const above = makeSkillProjectile({ id: 4, y: -100, lifetimeRemainSec: 10 });
    const world = makeWorld({ skillProjectiles: [expired, above] });
    applyMovement(world, makeInputState(), DT);
    expect(world.skillProjectiles[0].alive).toBe(false);
    expect(world.skillProjectiles[1].alive).toBe(false);
  });
});
