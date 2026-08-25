/**
 * Player/enemy movement plus independent regular and homing skill projectile paths.
 * @module @/game/systems/movement
 */
import type { ApplyMovement, Box, Enemy, SkillProjectile } from '@/contracts';

import { BALANCE } from '../balance';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function centerDistanceSquared(projectile: SkillProjectile, enemy: Enemy): number {
  const dx = enemy.x + enemy.width / 2 - (projectile.x + projectile.width / 2);
  const dy = enemy.y + enemy.height / 2 - (projectile.y + projectile.height / 2);
  return dx * dx + dy * dy;
}

function nearestAliveEnemy(
  projectile: SkillProjectile,
  enemies: readonly Enemy[],
): Enemy | undefined {
  let nearest: Enemy | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const distance = centerDistanceSquared(projectile, enemy);
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function resolveLockedTarget(
  projectile: SkillProjectile,
  enemies: readonly Enemy[],
): Enemy | undefined {
  if (projectile.targetId !== null) {
    const locked = enemies.find((enemy) => enemy.alive && enemy.id === projectile.targetId);
    if (locked !== undefined) return locked;
  }

  const target = nearestAliveEnemy(projectile, enemies);
  projectile.targetId = target?.id ?? null;
  return target;
}

function isFullyOutside(
  projectile: Readonly<Box>,
  bounds: Readonly<{ width: number; height: number }>,
): boolean {
  return (
    projectile.x > bounds.width ||
    projectile.x + projectile.width < 0 ||
    projectile.y > bounds.height ||
    projectile.y + projectile.height < 0
  );
}

export const applyMovement: ApplyMovement = (world, input, dt): void => {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    world.player.x += (dx / len) * BALANCE.player.speed * dt;
    world.player.y += (dy / len) * BALANCE.player.speed * dt;
  }
  world.player.x = clamp(world.player.x, 0, world.bounds.width - world.player.width);
  world.player.y = clamp(world.player.y, 0, world.bounds.height - world.player.height);

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    enemy.x -= BALANCE.enemy.speed * dt;
    if (enemy.x + enemy.width < 0) {
      enemy.alive = false;
    }
  }

  for (const projectile of world.regularProjectiles) {
    if (!projectile.alive) continue;
    projectile.x += BALANCE.regularProjectile.speed * dt;
    projectile.lifetimeRemainSec = Math.max(0, projectile.lifetimeRemainSec - dt);
    if (projectile.lifetimeRemainSec <= 0 || projectile.x > world.bounds.width) {
      projectile.alive = false;
    }
  }

  for (const projectile of world.skillProjectiles) {
    if (!projectile.alive) continue;
    const target = resolveLockedTarget(projectile, world.enemies);
    if (target !== undefined) {
      const targetDx = target.x + target.width / 2 - (projectile.x + projectile.width / 2);
      const targetDy = target.y + target.height / 2 - (projectile.y + projectile.height / 2);
      const targetDistance = Math.hypot(targetDx, targetDy);
      let desiredVx = BALANCE.skillProjectile.speed;
      let desiredVy = 0;
      if (Number.isFinite(targetDistance) && targetDistance > Number.EPSILON) {
        desiredVx = (targetDx / targetDistance) * BALANCE.skillProjectile.speed;
        desiredVy = (targetDy / targetDistance) * BALANCE.skillProjectile.speed;
      }

      const turnFactor =
        targetDistance < projectile.nearTurnDistancePx
          ? projectile.nearTurnFactor
          : projectile.farTurnFactor;
      const steeredVx = projectile.vx + (desiredVx - projectile.vx) * turnFactor;
      const steeredVy = projectile.vy + (desiredVy - projectile.vy) * turnFactor;
      const steeredSpeed = Math.hypot(steeredVx, steeredVy);
      if (Number.isFinite(steeredSpeed) && steeredSpeed > Number.EPSILON) {
        projectile.vx = (steeredVx / steeredSpeed) * BALANCE.skillProjectile.speed;
        projectile.vy = (steeredVy / steeredSpeed) * BALANCE.skillProjectile.speed;
      } else {
        projectile.vx = desiredVx;
        projectile.vy = desiredVy;
      }
    }

    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.lifetimeRemainSec = Math.max(0, projectile.lifetimeRemainSec - dt);
    if (projectile.lifetimeRemainSec <= 0 || isFullyOutside(projectile, world.bounds)) {
      projectile.alive = false;
    }
  }

  for (const projectile of world.enemyProjectiles) {
    if (!projectile.alive) continue;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.lifetimeRemainSec = Math.max(0, projectile.lifetimeRemainSec - dt);
    if (projectile.lifetimeRemainSec <= 0 || isFullyOutside(projectile, world.bounds)) {
      projectile.alive = false;
    }
  }
};
