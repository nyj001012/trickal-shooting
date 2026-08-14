/**
 * Enemy spawn timing. Spawns fully off-screen at the right edge (INV-SPAWN-1) so a
 * fresh enemy can never overlap the player the same tick it appears.
 * @module @/game/systems/spawner
 */
import type { SpawnTick } from '@/contracts';

import { BALANCE } from '../balance';

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
  });
  world.nextEntityId += 1;
};
