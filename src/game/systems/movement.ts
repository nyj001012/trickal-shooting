/**
 * Player movement (diagonal-normalized, both-axis clamped — INV-MOVE-1/2), enemy
 * left-drift + offscreen removal, and projectile +x drift + lifetime/offscreen expiry.
 * Executed in this fixed sub-order every tick (see invariants.md).
 * @module @/game/systems/movement
 */
import type { ApplyMovement } from '@/contracts';

import { BALANCE } from '../balance';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const applyMovement: ApplyMovement = (world, input, dt): void => {
  // 1. Player: diagonal-normalized displacement (INV-MOVE-1), then clamp both axes
  //    inside the same tick (INV-MOVE-2).
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    world.player.x += (dx / len) * BALANCE.player.speed * dt;
    world.player.y += (dy / len) * BALANCE.player.speed * dt;
  }
  world.player.x = clamp(world.player.x, 0, world.bounds.width - world.player.width);
  world.player.y = clamp(world.player.y, 0, world.bounds.height - world.player.height);

  // 2. Enemies: drift left; escaping off the left edge only removes the enemy.
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    enemy.x -= BALANCE.enemy.speed * dt;
    if (enemy.x + enemy.width < 0) {
      enemy.alive = false;
    }
  }

  // 3. Projectiles: drift right; expire on lifetime or once fully past the right edge.
  for (const projectile of world.projectiles) {
    if (!projectile.alive) continue;
    projectile.x += BALANCE.projectile.speed * dt;
    projectile.lifetimeRemainSec = Math.max(0, projectile.lifetimeRemainSec - dt);
    if (projectile.lifetimeRemainSec <= 0 || projectile.x > world.bounds.width) {
      projectile.alive = false;
    }
  }
};
