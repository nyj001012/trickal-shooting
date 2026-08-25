/**
 * Enemy spawn timing. Spawns fully off-screen at the right edge (INV-SPAWN-1) so a
 * fresh enemy can never overlap the player the same tick it appears.
 * @module @/game/systems/spawner
 */
import type { SpawnTick } from '@/contracts';

import { BALANCE } from '../balance';

/**
 * `projSpeed` snapshot formula (INV-EPROJ-1) — computed once, here, from the CURRENT
 * level at spawn time and frozen on the resulting `Enemy` forever after.
 */
function computeProjSpeed(level: number): number {
  const raw = BALANCE.enemyProjectile.speedBase + BALANCE.enemyProjectile.speedPerLevel * (level - 1);
  return Math.min(Math.max(raw, BALANCE.enemyProjectile.speedBase), BALANCE.enemyProjectile.speedMax);
}

/**
 * Fire-interval formula (INV-EPROJ-2) — recomputed from the CURRENT level every time a
 * cooldown resets (both here, for the initial value, and in `fireEnemyProjectiles`).
 */
function computeFireIntervalSec(level: number): number {
  return Math.max(
    BALANCE.enemyProjectile.fireIntervalBase -
      BALANCE.enemyProjectile.fireIntervalDecayPerLevel * (level - 1),
    BALANCE.enemyProjectile.fireIntervalMinSec,
  );
}

export const spawnTick: SpawnTick = (world, dt, rng): void => {
  world.spawner.intervalRemainSec -= dt;
  if (world.spawner.intervalRemainSec > 0) {
    return;
  }
  world.spawner.intervalRemainSec = world.spawner.currentIntervalSec;

  if (world.enemies.filter((enemy) => enemy.alive).length >= BALANCE.limits.maxEnemies) {
    return;
  }

  const spawnableHeight = world.bounds.height - BALANCE.enemy.height - BALANCE.spawn.marginY * 2;
  const y = BALANCE.spawn.marginY + rng() * Math.max(0, spawnableHeight);

  world.enemies.push({
    id: world.nextEntityId,
    kind: 'enemy',
    alive: true,
    x: world.bounds.width,
    y,
    width: BALANCE.enemy.width,
    height: BALANCE.enemy.height,
    hp: BALANCE.enemy.hp,
    scoreValue: BALANCE.enemy.scoreValue,
    manaGain: BALANCE.enemy.manaGain,
    contactDamage: BALANCE.enemy.contactDamage,
    projSpeed: computeProjSpeed(world.session.level),
    projFireCooldownRemainSec: computeFireIntervalSec(world.session.level),
  });
  world.nextEntityId += 1;
};
