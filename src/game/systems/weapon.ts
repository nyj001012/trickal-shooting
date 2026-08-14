/**
 * Automatic player fire: cooldown always ticks down first; a shot is spawned whenever
 * it becomes ready, without reading user input (D-2, INV-FIRE-1).
 * @module @/game/systems/weapon
 */
import type { FireWeapon } from '@/contracts';

import { BALANCE } from '../balance';

export const fireWeapon: FireWeapon = (world, dt): void => {
  const nextCooldown = world.player.fireCooldownRemainSec - dt;
  world.player.fireCooldownRemainSec = nextCooldown <= Number.EPSILON ? 0 : nextCooldown;

  if (world.player.fireCooldownRemainSec > 0) {
    return;
  }
  if (
    world.projectiles.filter((projectile) => projectile.alive).length >=
    BALANCE.limits.maxProjectiles
  ) {
    world.player.fireCooldownRemainSec = BALANCE.player.fireCooldownSec;
    return;
  }

  world.projectiles.push({
    id: world.nextEntityId,
    kind: 'projectile',
    alive: true,
    x: world.player.x,
    y: world.player.y,
    width: BALANCE.projectile.width,
    height: BALANCE.projectile.height,
    damage: BALANCE.projectile.damage,
    lifetimeRemainSec: BALANCE.projectile.lifetimeSec,
  });
  world.nextEntityId += 1;
  world.player.fireCooldownRemainSec = BALANCE.player.fireCooldownSec;
};
