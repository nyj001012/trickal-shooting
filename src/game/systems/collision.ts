/**
 * Read-only overlap detection with independent regular/skill hit results.
 * @module @/game/systems/collision
 */
import type {
  AabbOverlap,
  Box,
  CollisionResult,
  DetectCollisions,
  PlayerContact,
  RegularProjectileHit,
  SkillProjectileHit,
} from '@/contracts';

export const aabbOverlap: AabbOverlap = (a: Readonly<Box>, b: Readonly<Box>): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const detectCollisions: DetectCollisions = (world): CollisionResult => {
  const aliveEnemies = world.enemies.filter((enemy) => enemy.alive);
  const regularProjectileHits: RegularProjectileHit[] = [];
  const skillProjectileHits: SkillProjectileHit[] = [];

  for (const projectile of world.regularProjectiles) {
    if (!projectile.alive) continue;
    for (const enemy of aliveEnemies) {
      if (aabbOverlap(projectile, enemy)) {
        regularProjectileHits.push({ projectile, enemy });
      }
    }
  }

  for (const projectile of world.skillProjectiles) {
    if (!projectile.alive) continue;
    for (const enemy of aliveEnemies) {
      if (aabbOverlap(projectile, enemy)) {
        skillProjectileHits.push({ projectile, enemy });
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

  return { regularProjectileHits, skillProjectileHits, playerContacts };
};
