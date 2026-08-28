// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyMovement } from '@/game/systems/movement';
import { BALANCE } from '@/game/balance';
import {
  makeEnemy,
  makeEnemyProjectile,
  makeHealingItem,
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

describe('applyMovement — enemy action-based motion (issue #19)', () => {
  describe('DASH — constant velocity from dashVx/dashVy (INV-EAI-2)', () => {
    it('integrates position by dashVx * dt / dashVy * dt and leaves the velocity fields untouched', () => {
      const enemy = makeEnemy({ x: 400, y: 300, action: 'dash', dashVx: -90, dashVy: 45 });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      const moved = world.enemies[0];
      expect(moved.x).toBeCloseTo(400 + -90 * DT, 8);
      expect(moved.y).toBeCloseTo(300 + 45 * DT, 8);
      expect(moved.dashVx).toBe(-90);
      expect(moved.dashVy).toBe(45);
    });

    it('does not move a dead enemy', () => {
      const enemy = makeEnemy({
        x: 400,
        y: 300,
        action: 'dash',
        dashVx: -90,
        dashVy: 0,
        alive: false,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      expect(world.enemies[0].x).toBe(400);
      expect(world.enemies[0].y).toBe(300);
    });
  });

  describe('OSCILLATE — sine wave around oscillateBaseY plus constant leftward drift (INV-EAI-3)', () => {
    it('drifts x left by oscillateDriftSpeed * dt, advances oscillatePhaseSec by dt, and sets y from the sine formula', () => {
      const enemy = makeEnemy({
        x: 400,
        y: 300,
        action: 'oscillate',
        oscillateBaseY: 300,
        oscillatePhaseSec: 0.2,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      const moved = world.enemies[0];
      expect(moved.x).toBeCloseTo(400 - BALANCE.enemyAi.oscillateDriftSpeed * DT, 8);
      expect(moved.oscillatePhaseSec).toBeCloseTo(0.2 + DT, 8);
      const expectedY =
        300 +
        BALANCE.enemyAi.oscillateAmplitudePx *
          Math.sin(((2 * Math.PI) / BALANCE.enemyAi.oscillatePeriodSec) * (0.2 + DT));
      expect(moved.y).toBeCloseTo(expectedY, 8);
    });

    it('keeps oscillateBaseY fixed across ticks (the sine baseline never moves while OSCILLATE is active)', () => {
      const enemy = makeEnemy({
        x: 400,
        y: 260,
        action: 'oscillate',
        oscillateBaseY: 260,
        oscillatePhaseSec: 0,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      applyMovement(world, makeInputState(), DT);
      expect(world.enemies[0].oscillateBaseY).toBe(260);
    });

    it('does not move a dead enemy', () => {
      const enemy = makeEnemy({
        x: 400,
        y: 300,
        action: 'oscillate',
        oscillateBaseY: 300,
        alive: false,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      expect(world.enemies[0].x).toBe(400);
      expect(world.enemies[0].y).toBe(300);
    });
  });

  describe('CIRCLE — orbit around a center that drifts left, angle advances by angularSpeed * circleDir (INV-EAI-4)', () => {
    it('advances circleAngleRad, drifts circleCenterX left, keeps circleCenterY fixed, and derives x/y from the orbit formula', () => {
      const enemy = makeEnemy({
        action: 'circle',
        circleCenterX: 500,
        circleCenterY: 260,
        circleAngleRad: 0,
        circleDir: 1,
        width: 28,
        height: 28,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      const moved = world.enemies[0];
      const expectedCenterX = 500 - BALANCE.enemyAi.circleDriftSpeed * DT;
      const expectedAngle = BALANCE.enemyAi.circleAngularSpeedRadPerSec * 1 * DT;
      expect(moved.circleCenterX).toBeCloseTo(expectedCenterX, 8);
      expect(moved.circleAngleRad).toBeCloseTo(expectedAngle, 8);
      expect(moved.circleCenterY).toBe(260);
      expect(moved.x).toBeCloseTo(
        expectedCenterX + BALANCE.enemyAi.circleRadiusPx * Math.cos(expectedAngle) - 28 / 2,
        8,
      );
      expect(moved.y).toBeCloseTo(
        260 + BALANCE.enemyAi.circleRadiusPx * Math.sin(expectedAngle) - 28 / 2,
        8,
      );
    });

    it('reverses the angle-advance sign for circleDir = -1', () => {
      const enemy = makeEnemy({
        action: 'circle',
        circleCenterX: 500,
        circleCenterY: 260,
        circleAngleRad: 1,
        circleDir: -1,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      const expectedAngle = 1 - BALANCE.enemyAi.circleAngularSpeedRadPerSec * DT;
      expect(world.enemies[0].circleAngleRad).toBeCloseTo(expectedAngle, 8);
    });

    it('does not move a dead enemy', () => {
      const enemy = makeEnemy({
        action: 'circle',
        circleCenterX: 500,
        circleCenterY: 260,
        alive: false,
      });
      const world = makeWorld({ enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      expect(world.enemies[0].circleCenterX).toBe(500);
      expect(world.enemies[0].circleAngleRad).toBe(0);
    });
  });

  describe('common boundary rules across all three actions (INV-EAI-5)', () => {
    const bounds = { width: 800, height: 600 };
    const width = 28;
    const height = 28;

    it.each([
      { action: 'dash' as const, overrides: { dashVx: 0, dashVy: -100000 } },
      {
        action: 'oscillate' as const,
        overrides: {
          oscillateBaseY: -100000,
          oscillatePhaseSec: BALANCE.enemyAi.oscillatePeriodSec / 4,
        },
      },
      {
        action: 'circle' as const,
        overrides: { circleCenterX: 400, circleCenterY: -100000, circleAngleRad: Math.PI / 2 },
      },
    ])('clamps y to bounds top (0) when $action drives far above it', ({ action, overrides }) => {
      const enemy = makeEnemy({ x: 400, y: 0, width, height, action, ...overrides });
      const world = makeWorld({ bounds, enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      expect(world.enemies[0].y).toBe(0);
    });

    it.each([
      { action: 'dash' as const, overrides: { dashVx: 0, dashVy: 100000 } },
      {
        action: 'oscillate' as const,
        overrides: {
          oscillateBaseY: 100000,
          oscillatePhaseSec: BALANCE.enemyAi.oscillatePeriodSec / 4,
        },
      },
      {
        action: 'circle' as const,
        overrides: { circleCenterX: 400, circleCenterY: 100000, circleAngleRad: Math.PI / 2 },
      },
    ])(
      'clamps y to bounds bottom (bounds.height - height) when $action drives far below it',
      ({ action, overrides }) => {
        const enemy = makeEnemy({ x: 400, y: bounds.height - height, width, height, action, ...overrides });
        const world = makeWorld({ bounds, enemies: [enemy] });
        applyMovement(world, makeInputState(), DT);
        expect(world.enemies[0].y).toBe(bounds.height - height);
      },
    );

    it.each([
      { action: 'dash' as const, overrides: { dashVx: 100000, dashVy: 0 } },
      { action: 'oscillate' as const, overrides: { oscillateBaseY: 300 } },
      {
        action: 'circle' as const,
        overrides: { circleCenterX: 100000, circleCenterY: 300, circleAngleRad: 0 },
      },
    ])('clamps x to bounds.width - width (right edge only) when $action drives far past it', ({ action, overrides }) => {
      const enemy = makeEnemy({
        x: action === 'oscillate' ? 100000 : 400,
        y: 300,
        width,
        height,
        action,
        ...overrides,
      });
      const world = makeWorld({ bounds, enemies: [enemy] });
      applyMovement(world, makeInputState(), DT);
      expect(world.enemies[0].x).toBe(bounds.width - width);
    });

    it.each([
      { action: 'dash' as const, overrides: { dashVx: -100000, dashVy: 0 } },
      { action: 'oscillate' as const, overrides: { oscillateBaseY: 300 } },
      {
        action: 'circle' as const,
        overrides: { circleCenterX: -100000, circleCenterY: 300, circleAngleRad: 0 },
      },
    ])(
      'never clamps the left edge and marks the enemy dead once it fully exits it, for $action (INV-ESCAPE-1)',
      ({ action, overrides }) => {
        const enemy = makeEnemy({
          x: action === 'oscillate' ? -100000 : 400,
          y: 300,
          width,
          height,
          action,
          ...overrides,
        });
        const world = makeWorld({ bounds, enemies: [enemy] });
        applyMovement(world, makeInputState(), DT);
        expect(world.enemies[0].alive).toBe(false);
      },
    );
  });

  it('marks an enemy dead without changing session or invulnerability once its right edge crosses the left screen edge', () => {
    const escaping = makeEnemy({ x: -1000, width: 28, action: 'dash', dashVx: -BALANCE.enemy.speed, dashVy: 0 }); // already far past the left edge
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
      action: 'dash',
      dashVx: -BALANCE.enemy.speed,
      dashVy: 0,
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
    expect(moved.targetId).toBe(nearer.id);
    expect(Math.hypot(moved.vx, moved.vy)).toBeCloseTo(BALANCE.skillProjectile.speed, 5);
    expect(moved.vx).toBeGreaterThan(0);
    expect(moved.vy).toBeGreaterThan(0);
    expect(moved.x).toBeCloseTo(100 + moved.vx * DT, 5);
    expect(moved.y).toBeCloseTo(100 + moved.vy * DT, 5);
  });

  it('turns gradually toward a target instead of snapping to its desired velocity', () => {
    const projectile = makeSkillProjectile({
      x: 100,
      y: 100,
      vx: BALANCE.skillProjectile.speed,
      vy: 0,
      farTurnFactor: BALANCE.skillProjectile.farTurnFactor,
    });
    const target = makeEnemy({
      x: projectile.x + projectile.width / 2 - BALANCE.enemy.width / 2 + BALANCE.enemy.speed * DT,
      y: 300,
    });
    const world = makeWorld({ enemies: [target], skillProjectiles: [projectile] });

    applyMovement(world, makeInputState(), DT);

    const moved = world.skillProjectiles[0];
    const steeredVx = BALANCE.skillProjectile.speed * (1 - projectile.farTurnFactor);
    const steeredVy = BALANCE.skillProjectile.speed * projectile.farTurnFactor;
    const steeredSpeed = Math.hypot(steeredVx, steeredVy);
    expect(moved.vx).toBeCloseTo((steeredVx / steeredSpeed) * BALANCE.skillProjectile.speed, 5);
    expect(moved.vy).toBeCloseTo((steeredVy / steeredSpeed) * BALANCE.skillProjectile.speed, 5);
    expect(moved.vx).toBeGreaterThan(0);
    expect(moved.vy).toBeGreaterThan(0);
    expect(Math.hypot(moved.vx, moved.vy)).toBeCloseTo(BALANCE.skillProjectile.speed, 5);
  });

  it('uses the first enemy in array order when nearest distances are tied', () => {
    const projectile = makeSkillProjectile({ x: 100, y: 100, vx: 0, vy: 0 });
    const first = makeEnemy({ id: 1, x: 250, y: 68 });
    const second = makeEnemy({ id: 2, x: 250, y: 124 });
    const world = makeWorld({ enemies: [first, second], skillProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.skillProjectiles[0].targetId).toBe(first.id);
    expect(world.skillProjectiles[0].vy).toBeLessThan(0);
  });

  it('keeps its locked target even when another alive enemy becomes closer', () => {
    const projectile = makeSkillProjectile({
      x: 100,
      y: 100,
      vx: BALANCE.skillProjectile.speed,
      vy: 0,
      targetId: 1,
    });
    const locked = makeEnemy({ id: 1, x: 500, y: 20 });
    const closer = makeEnemy({ id: 2, x: 150, y: 300 });
    const world = makeWorld({ enemies: [locked, closer], skillProjectiles: [projectile] });

    applyMovement(world, makeInputState(), DT);

    expect(world.skillProjectiles[0].targetId).toBe(locked.id);
    expect(world.skillProjectiles[0].vy).toBeLessThan(0);
  });

  it('reacquires the nearest alive enemy only after the locked target is gone', () => {
    const projectile = makeSkillProjectile({
      x: 100,
      y: 100,
      vx: BALANCE.skillProjectile.speed,
      vy: 0,
      targetId: 1,
    });
    const deadLocked = makeEnemy({ id: 1, x: 120, y: 300, alive: false });
    const replacement = makeEnemy({ id: 2, x: 220, y: 20 });
    const world = makeWorld({
      enemies: [deadLocked, replacement],
      skillProjectiles: [projectile],
    });

    applyMovement(world, makeInputState(), DT);

    expect(world.skillProjectiles[0].targetId).toBe(replacement.id);
    expect(world.skillProjectiles[0].vy).toBeLessThan(0);
  });

  it('uses the near turn boost below 150px and the far factor at exactly 150px', () => {
    function steerAtDistance(distancePx: number) {
      const projectile = makeSkillProjectile({
        x: 100,
        y: 100,
        vx: BALANCE.skillProjectile.speed,
        vy: 0,
        targetId: 1,
      });
      const target = makeEnemy({
        id: 1,
        x: projectile.x + projectile.width / 2 - BALANCE.enemy.width / 2 + BALANCE.enemy.speed * DT,
        y: projectile.y + projectile.height / 2 + distancePx - BALANCE.enemy.height / 2,
      });
      const world = makeWorld({ enemies: [target], skillProjectiles: [projectile] });
      applyMovement(world, makeInputState(), DT);
      return world.skillProjectiles[0];
    }

    const near = steerAtDistance(BALANCE.skillProjectile.nearTurnDistancePx - 50);
    const atThreshold = steerAtDistance(BALANCE.skillProjectile.nearTurnDistancePx);

    function expectedVelocity(turnFactor: number): { vx: number; vy: number } {
      const steeredVx = BALANCE.skillProjectile.speed * (1 - turnFactor);
      const steeredVy = BALANCE.skillProjectile.speed * turnFactor;
      const speed = Math.hypot(steeredVx, steeredVy);
      return {
        vx: (steeredVx / speed) * BALANCE.skillProjectile.speed,
        vy: (steeredVy / speed) * BALANCE.skillProjectile.speed,
      };
    }

    const expectedNear = expectedVelocity(BALANCE.skillProjectile.nearTurnFactor);
    const expectedFar = expectedVelocity(BALANCE.skillProjectile.farTurnFactor);
    expect(near.vx).toBeCloseTo(expectedNear.vx, 5);
    expect(near.vy).toBeCloseTo(expectedNear.vy, 5);
    expect(atThreshold.vx).toBeCloseTo(expectedFar.vx, 5);
    expect(atThreshold.vy).toBeCloseTo(expectedFar.vy, 5);
    expect(near.vy).toBeGreaterThan(atThreshold.vy);
    expect(Math.hypot(near.vx, near.vy)).toBeCloseTo(BALANCE.skillProjectile.speed, 5);
    expect(Math.hypot(atThreshold.vx, atThreshold.vy)).toBeCloseTo(
      BALANCE.skillProjectile.speed,
      5,
    );
  });

  it('clears a stale target id and retains its current inertia when no alive target exists', () => {
    const projectile = makeSkillProjectile({
      x: 100,
      y: 100,
      vx: 700,
      vy: 120,
      targetId: 99,
    });
    const world = makeWorld({
      enemies: [makeEnemy({ alive: false })],
      skillProjectiles: [projectile],
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.skillProjectiles[0].targetId).toBeNull();
    expect(world.skillProjectiles[0].vx).toBe(700);
    expect(world.skillProjectiles[0].vy).toBe(120);
    expect(world.skillProjectiles[0].x).toBeCloseTo(100 + 700 * DT, 5);
    expect(world.skillProjectiles[0].y).toBeCloseTo(100 + 120 * DT, 5);
  });

  it('falls back to the desired velocity when steering produces a zero or non-finite vector', () => {
    const zeroVector = makeSkillProjectile({
      x: 100,
      y: 100,
      vx: -BALANCE.skillProjectile.speed,
      vy: 0,
      targetId: 1,
      nearTurnFactor: 0.5,
    });
    const nonFiniteVector = makeSkillProjectile({
      id: 4,
      x: 100,
      y: 100,
      vx: Number.POSITIVE_INFINITY,
      vy: 0,
    });
    const target = makeEnemy({
      x: 202,
      y: 96,
    });
    const world = makeWorld({
      enemies: [target],
      skillProjectiles: [zeroVector, nonFiniteVector],
    });

    applyMovement(world, makeInputState(), DT);

    for (const moved of world.skillProjectiles) {
      expect(Number.isFinite(moved.vx)).toBe(true);
      expect(Number.isFinite(moved.vy)).toBe(true);
      expect(moved.vx).toBe(BALANCE.skillProjectile.speed);
      expect(moved.vy).toBe(0);
    }
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

describe('applyMovement — enemy projectiles fixed-velocity travel (issue #17, INV-EPROJ-3)', () => {
  it('moves an alive enemy projectile by its own fixed vx/vy and decrements lifetime', () => {
    const projectile = makeEnemyProjectile({
      x: 400,
      y: 300,
      vx: 90,
      vy: -60,
      lifetimeRemainSec: 3,
    });
    const world = makeWorld({ enemyProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    const moved = world.enemyProjectiles[0];
    expect(moved.x).toBeCloseTo(400 + 90 * DT, 5);
    expect(moved.y).toBeCloseTo(300 - 60 * DT, 5);
    expect(moved.lifetimeRemainSec).toBeCloseTo(3 - DT, 5);
    // vx/vy themselves must never be re-derived here (contrast with SkillProjectile).
    expect(moved.vx).toBe(90);
    expect(moved.vy).toBe(-60);
  });

  it('does not move a dead enemy projectile', () => {
    const projectile = makeEnemyProjectile({ x: 400, y: 300, vx: 90, vy: 90, alive: false });
    const world = makeWorld({ enemyProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].x).toBe(400);
    expect(world.enemyProjectiles[0].y).toBe(300);
  });

  it('expires the tick it fully crosses the right edge (x > bounds.width)', () => {
    const projectile = makeEnemyProjectile({ x: 801, y: 300, vx: 0, vy: 0, lifetimeRemainSec: 10 });
    const world = makeWorld({
      bounds: { width: 800, height: 600 },
      enemyProjectiles: [projectile],
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].alive).toBe(false);
  });

  it('expires the tick it fully crosses the left edge (x + width < 0)', () => {
    const projectile = makeEnemyProjectile({
      x: -11,
      y: 300,
      width: 10,
      vx: 0,
      vy: 0,
      lifetimeRemainSec: 10,
    });
    const world = makeWorld({ enemyProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].alive).toBe(false);
  });

  it('expires the tick it fully crosses the top edge (y + height < 0)', () => {
    const projectile = makeEnemyProjectile({
      x: 400,
      y: -11,
      height: 10,
      vx: 0,
      vy: 0,
      lifetimeRemainSec: 10,
    });
    const world = makeWorld({ enemyProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].alive).toBe(false);
  });

  it('expires the tick it fully crosses the bottom edge (y > bounds.height)', () => {
    const projectile = makeEnemyProjectile({ x: 400, y: 601, vx: 0, vy: 0, lifetimeRemainSec: 10 });
    const world = makeWorld({
      bounds: { width: 800, height: 600 },
      enemyProjectiles: [projectile],
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].alive).toBe(false);
  });

  it('stays alive while exactly touching (not exceeding) the right and bottom boundaries', () => {
    const atRight = makeEnemyProjectile({ x: 800, y: 300, vx: 0, vy: 0, lifetimeRemainSec: 10 });
    const atBottom = makeEnemyProjectile({
      id: 5,
      x: 400,
      y: 600,
      vx: 0,
      vy: 0,
      lifetimeRemainSec: 10,
    });
    const world = makeWorld({
      bounds: { width: 800, height: 600 },
      enemyProjectiles: [atRight, atBottom],
    });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].alive).toBe(true);
    expect(world.enemyProjectiles[1].alive).toBe(true);
  });

  it('does not expire mid-flight while moving diagonally and remaining inside the bounds', () => {
    const speed = BALANCE.enemyProjectile.speedBase;
    const diagonal = Math.SQRT1_2 * speed;
    const projectile = makeEnemyProjectile({
      x: 400,
      y: 300,
      vx: diagonal,
      vy: diagonal,
      lifetimeRemainSec: 10,
    });
    const world = makeWorld({ enemyProjectiles: [projectile] });
    for (let i = 0; i < 10; i += 1) {
      applyMovement(world, makeInputState(), DT);
    }
    expect(world.enemyProjectiles[0].alive).toBe(true);
    expect(world.enemyProjectiles[0].x).toBeCloseTo(400 + diagonal * DT * 10, 5);
    expect(world.enemyProjectiles[0].y).toBeCloseTo(300 + diagonal * DT * 10, 5);
  });

  it('expires an enemy projectile by lifetime even while still inside the bounds', () => {
    const projectile = makeEnemyProjectile({
      x: 400,
      y: 300,
      vx: 0,
      vy: 0,
      lifetimeRemainSec: DT / 2,
    });
    const world = makeWorld({ enemyProjectiles: [projectile] });
    applyMovement(world, makeInputState(), DT);
    expect(world.enemyProjectiles[0].alive).toBe(false);
  });
});

describe('applyMovement — healing items: position fixed, lifetime countdown only (INV-ITEM-2, issue #21, 2026-08-28 drift-removal revision)', () => {
  it('decrements lifetimeRemainSec by exactly dt each tick and leaves x/y untouched', () => {
    const item = makeHealingItem({ x: 400, y: 300, lifetimeRemainSec: 2 });
    const world = makeWorld({ healingItems: [item] });
    applyMovement(world, makeInputState(), DT);
    const moved = world.healingItems[0];
    expect(moved.lifetimeRemainSec).toBeCloseTo(2 - DT, 8);
    expect(moved.x).toBe(400);
    expect(moved.y).toBe(300);
    expect(moved.alive).toBe(true);
  });

  it('keeps x/y exactly fixed at their spawn values across many ticks (no drift, no clamp, no re-derivation)', () => {
    const item = makeHealingItem({ x: 123.5, y: 77.25, lifetimeRemainSec: 4 });
    const world = makeWorld({ healingItems: [item] });
    for (let i = 0; i < 30; i += 1) {
      applyMovement(world, makeInputState(), DT);
    }
    expect(world.healingItems[0].x).toBe(123.5);
    expect(world.healingItems[0].y).toBe(77.25);
  });

  it('does not move or decrement a dead healing item', () => {
    const item = makeHealingItem({ x: 400, y: 300, lifetimeRemainSec: 2, alive: false });
    const world = makeWorld({ healingItems: [item] });
    applyMovement(world, makeInputState(), DT);
    expect(world.healingItems[0].x).toBe(400);
    expect(world.healingItems[0].y).toBe(300);
    expect(world.healingItems[0].lifetimeRemainSec).toBe(2);
    expect(world.healingItems[0].alive).toBe(false);
  });

  it('despawns (alive=false) the exact tick lifetimeRemainSec reaches 0', () => {
    const item = makeHealingItem({ lifetimeRemainSec: DT });
    const world = makeWorld({ healingItems: [item] });
    applyMovement(world, makeInputState(), DT);
    expect(world.healingItems[0].lifetimeRemainSec).toBe(0);
    expect(world.healingItems[0].alive).toBe(false);
  });

  it('floors lifetimeRemainSec at 0 (never negative) when dt overshoots the remaining lifetime', () => {
    const item = makeHealingItem({ lifetimeRemainSec: DT / 2 });
    const world = makeWorld({ healingItems: [item] });
    applyMovement(world, makeInputState(), DT);
    expect(world.healingItems[0].lifetimeRemainSec).toBe(0);
    expect(world.healingItems[0].alive).toBe(false);
  });

  it('stays alive the tick immediately before lifetimeRemainSec would reach 0', () => {
    const item = makeHealingItem({ lifetimeRemainSec: DT * 1.5 });
    const world = makeWorld({ healingItems: [item] });
    applyMovement(world, makeInputState(), DT);
    expect(world.healingItems[0].lifetimeRemainSec).toBeCloseTo(DT * 0.5, 8);
    expect(world.healingItems[0].alive).toBe(true);
  });

  it('despawns from a realistic multi-tick countdown once roughly lifetimeSec worth of ticks have elapsed', () => {
    // Repeatedly subtracting DT (= 1/60, a non-terminating binary fraction) accumulates
    // floating-point summation error, so the nominal tick count (totalLifetimeSec / DT)
    // can land a hair on either side of the true zero-crossing. The exact-zero boundary
    // itself is already pinned precisely, without any accumulated error, by the
    // single-tick tests above (lifetimeRemainSec set directly to DT, DT/2, and DT*1.5).
    // This test only needs to confirm the countdown behaves sanely over many ticks:
    // still alive well before the nominal count, and dead shortly after it.
    const totalLifetimeSec = 4;
    const item = makeHealingItem({ lifetimeRemainSec: totalLifetimeSec });
    const world = makeWorld({ healingItems: [item] });
    const nominalTicks = Math.round(totalLifetimeSec / DT);
    for (let i = 0; i < nominalTicks - 5; i += 1) {
      applyMovement(world, makeInputState(), DT);
    }
    expect(world.healingItems[0].alive).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      applyMovement(world, makeInputState(), DT);
    }
    expect(world.healingItems[0].alive).toBe(false);
  });
});
