// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aabbOverlap, detectCollisions } from '@/game/systems/collision';
import {
  makeEnemy,
  makePlayer,
  makeRegularProjectile,
  makeSkillProjectile,
  makeWorld,
} from '../helpers/fixtures';

describe('aabbOverlap — boundary conditions', () => {
  it('is true for full containment (one box entirely inside another)', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 40, y: 40, width: 10, height: 10 };
    expect(aabbOverlap(outer, inner)).toBe(true);
    expect(aabbOverlap(inner, outer)).toBe(true);
  });

  it('is true for a classic partial overlap', () => {
    const a = { x: 0, y: 0, width: 20, height: 20 };
    const b = { x: 10, y: 10, width: 20, height: 20 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('is false when boxes are adjacent but separated by a gap (no touching at all)', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 11, y: 0, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('is false when boxes merely touch at an edge or a single corner (zero-area intersection)', () => {
    // Not just a geometric nicety: INV-SPAWN-1 requires that a freshly spawned
    // enemy (x === bounds.width) never overlaps a player clamped to the far-right
    // edge (player.x + player.width === bounds.width — i.e. exactly touching the
    // spawn edge, since INV-MOVE-2 allows the player's AABB to reach the boundary
    // exactly). If edge-touching counted as "overlap", a spawn at the
    // maximum-clamped player position would violate INV-SPAWN-1 on arrival. So the
    // overlap test must use strict inequalities (touching != overlapping).
    const rightEdge = { x: 0, y: 0, width: 10, height: 10 };
    const touchingRightEdge = { x: 10, y: 0, width: 10, height: 10 }; // b.x === a.x + a.width
    expect(aabbOverlap(rightEdge, touchingRightEdge)).toBe(false);

    const cornerA = { x: 0, y: 0, width: 10, height: 10 };
    const cornerB = { x: 10, y: 10, width: 10, height: 10 }; // touches only at the (10,10) corner
    expect(aabbOverlap(cornerA, cornerB)).toBe(false);
  });
});

describe('detectCollisions — separated projectile hit lists', () => {
  it('reports regular and skill overlaps independently', () => {
    const enemy = makeEnemy({ id: 1, x: 100, y: 100, width: 28, height: 28 });
    const regular = makeRegularProjectile({ id: 2, x: 100, y: 100 });
    const skill = makeSkillProjectile({ id: 3, x: 100, y: 100 });
    const world = makeWorld({
      enemies: [enemy],
      regularProjectiles: [regular],
      skillProjectiles: [skill],
    });

    const result = detectCollisions(world);

    expect(result.regularProjectileHits).toHaveLength(1);
    expect(result.regularProjectileHits[0].projectile.id).toBe(2);
    expect(result.skillProjectileHits).toHaveLength(1);
    expect(result.skillProjectileHits[0].projectile.id).toBe(3);
    expect(result.skillProjectileHits[0].enemy.id).toBe(1);
    expect(result.playerContacts).toHaveLength(0);
  });

  it('reports an alive player x alive enemy overlap as a PlayerContact', () => {
    const player = makePlayer({ x: 200, y: 200, width: 32, height: 32 });
    const enemy = makeEnemy({ id: 5, x: 200, y: 200, width: 28, height: 28 });
    const world = makeWorld({ player, enemies: [enemy] });

    const result = detectCollisions(world);

    expect(result.playerContacts).toHaveLength(1);
    expect(result.playerContacts[0].enemy.id).toBe(5);
    expect(result.regularProjectileHits).toHaveLength(0);
    expect(result.skillProjectileHits).toHaveLength(0);
  });

  it('ignores entities already marked dead (alive: false)', () => {
    const player = makePlayer({ x: 200, y: 200, width: 32, height: 32 });
    const deadEnemy = makeEnemy({ id: 9, x: 200, y: 200, alive: false });
    const deadRegular = makeRegularProjectile({ id: 10, x: 200, y: 200, alive: false });
    const deadSkill = makeSkillProjectile({ id: 11, x: 200, y: 200, alive: false });
    const world = makeWorld({
      player,
      enemies: [deadEnemy],
      regularProjectiles: [deadRegular],
      skillProjectiles: [deadSkill],
    });

    const result = detectCollisions(world);

    expect(result.playerContacts).toHaveLength(0);
    expect(result.regularProjectileHits).toHaveLength(0);
    expect(result.skillProjectileHits).toHaveLength(0);
  });

  it('is a pure read: it never mutates the world it scans (§6.4 — "판정 함수는 부수효과가 없어야 한다")', () => {
    const enemy = makeEnemy({ id: 1, x: 100, y: 100 });
    const regular = makeRegularProjectile({ id: 2, x: 100, y: 100 });
    const skill = makeSkillProjectile({ id: 3, x: 100, y: 100 });
    const world = makeWorld({
      enemies: [enemy],
      regularProjectiles: [regular],
      skillProjectiles: [skill],
    });
    const before = structuredClone(world);

    detectCollisions(world);

    expect(world).toEqual(before);
  });
});
