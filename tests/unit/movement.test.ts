// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyMovement } from '@/game/systems/movement';
import { BALANCE } from '@/game/balance';
import {
  makeEnemy,
  makeInputState,
  makePlayer,
  makeProjectile,
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

describe('applyMovement — enemies move left and escape damage is independent of invulnerability (D-5)', () => {
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

  it('marks an enemy dead and reduces HP by escapeDamage once its right edge crosses the left screen edge', () => {
    const escaping = makeEnemy({ x: -1000, width: 28 }); // already far past the left edge
    const world = makeWorld({
      enemies: [escaping],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemies[0].alive).toBe(false);
    expect(world.session.hp).toBe(3 - BALANCE.enemy.escapeDamage);
  });

  it('applies escape damage even while the player is currently invulnerable — escape damage is a mechanism independent of contact damage (invariants.md INV-DMG-1 scope note)', () => {
    const escaping = makeEnemy({ x: -1000, width: 28 });
    const world = makeWorld({
      player: makePlayer({ invulnRemainSec: BALANCE.player.invulnSec }),
      enemies: [escaping],
      session: { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.session.hp).toBe(3 - BALANCE.enemy.escapeDamage);
  });

  it('never lets HP from escape damage drop below 0', () => {
    const escaping = makeEnemy({ x: -1000, width: 28 });
    const world = makeWorld({
      enemies: [escaping],
      session: { hp: 0, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' },
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.session.hp).toBe(0);
  });
});

describe('applyMovement — projectiles always travel +x and expire safely (D-2)', () => {
  it('moves alive projectiles right by speed * dt and decrements lifetime', () => {
    const projectile = makeProjectile({ x: 100, y: 300, lifetimeRemainSec: 2 });
    const world = makeWorld({ projectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.projectiles[0].x).toBeCloseTo(100 + BALANCE.projectile.speed * DT, 5);
    expect(world.projectiles[0].lifetimeRemainSec).toBeCloseTo(2 - DT, 5);
  });

  it('marks a projectile dead once its lifetime expires', () => {
    const projectile = makeProjectile({ x: 100, y: 300, lifetimeRemainSec: DT / 2 });
    const world = makeWorld({ projectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.projectiles[0].alive).toBe(false);
  });

  it('marks a projectile dead once it crosses the right screen edge', () => {
    const bounds = { width: 800, height: 600 };
    const projectile = makeProjectile({ x: bounds.width + 1, y: 300, lifetimeRemainSec: 10 });
    const world = makeWorld({ bounds, projectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.projectiles[0].alive).toBe(false);
  });
});
