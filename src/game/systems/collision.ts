/**
 * Read-only overlap detection (design.md §6.4 — "판정 함수는 부수효과가 없어야 한다").
 * @module @/game/systems/collision
 */
import type {
  AabbOverlap,
  Box,
  CollisionResult,
  DetectCollisions,
  PlayerContact,
  ProjectileHit,
} from '@/contracts';

export const aabbOverlap: AabbOverlap = (a: Readonly<Box>, b: Readonly<Box>): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const detectCollisions: DetectCollisions = (world): CollisionResult => {
  const aliveEnemies = world.enemies.filter((enemy) => enemy.alive);
  const aliveProjectiles = world.projectiles.filter((projectile) => projectile.alive);

  const projectileHits: ProjectileHit[] = [];
  for (const projectile of aliveProjectiles) {
    for (const enemy of aliveEnemies) {
      if (aabbOverlap(projectile, enemy)) {
        projectileHits.push({ projectile, enemy });
      }
    }
  }

  const playerContacts: PlayerContact[] = [];
  if (world.player.alive) {
    for (const enemy of aliveEnemies) {
      if (aabbOverlap(world.player, enemy)) {
        playerContacts.push({ enemy });
      }
    }
  }

  return { projectileHits, playerContacts };
};
