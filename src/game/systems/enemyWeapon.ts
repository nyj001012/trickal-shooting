/**
 * Enemy-side auto-fire: every alive enemy independently counts down its own
 * `projFireCooldownRemainSec` and, on reaching zero, fires one `EnemyProjectile` in one
 * of 8 fixed compass directions using the firing enemy's frozen `projSpeed` snapshot
 * (INV-EPROJ-1) and resets its cooldown from the CURRENT level (INV-EPROJ-2).
 * @module @/game/systems/enemyWeapon
 */
import type { FireEnemyProjectiles } from '@/contracts';

import { BALANCE } from '../balance';

/** Fixed, order-significant 8-direction unit-vector table (issue #17 contract). */
const DIRECTION_TABLE: ReadonlyArray<{ readonly ux: number; readonly uy: number }> = [
  { ux: 1, uy: 0 },
  { ux: Math.SQRT1_2, uy: Math.SQRT1_2 },
  { ux: 0, uy: 1 },
  { ux: -Math.SQRT1_2, uy: Math.SQRT1_2 },
  { ux: -1, uy: 0 },
  { ux: -Math.SQRT1_2, uy: -Math.SQRT1_2 },
  { ux: 0, uy: -1 },
  { ux: Math.SQRT1_2, uy: -Math.SQRT1_2 },
];

/** Fire-interval formula (INV-EPROJ-2) — recomputed from the CURRENT level on every reset. */
function computeFireIntervalSec(level: number): number {
  return Math.max(
    BALANCE.enemyProjectile.fireIntervalBase -
      BALANCE.enemyProjectile.fireIntervalDecayPerLevel * (level - 1),
    BALANCE.enemyProjectile.fireIntervalMinSec,
  );
}

export const fireEnemyProjectiles: FireEnemyProjectiles = (world, dt, rng): void => {
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;

    enemy.projFireCooldownRemainSec = Math.max(0, enemy.projFireCooldownRemainSec - dt);
    if (enemy.projFireCooldownRemainSec > 0) continue;

    if (world.enemyProjectiles.length < BALANCE.limits.maxEnemyProjectiles) {
      const index = Math.min(7, Math.floor(rng() * 8));
      const direction = DIRECTION_TABLE[index];

      world.enemyProjectiles.push({
        id: world.nextEntityId,
        kind: 'enemyProjectile',
        alive: true,
        x: enemy.x + enemy.width / 2 - BALANCE.enemyProjectile.width / 2,
        y: enemy.y + enemy.height / 2 - BALANCE.enemyProjectile.height / 2,
        width: BALANCE.enemyProjectile.width,
        height: BALANCE.enemyProjectile.height,
        vx: direction.ux * enemy.projSpeed,
        vy: direction.uy * enemy.projSpeed,
        damage: BALANCE.enemyProjectile.damage,
        lifetimeRemainSec: BALANCE.enemyProjectile.lifetimeSec,
      });
      world.nextEntityId += 1;
    }

    enemy.projFireCooldownRemainSec = computeFireIntervalSec(world.session.level);
  }
};
