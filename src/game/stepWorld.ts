/**
 * Orchestrates exactly one fixed-size simulation tick in the order fixed by
 * `.claude/_workspace/03_contracts/invariants.md` §1. No-op unless `status === 'playing'`
 * (D-6). Dead-entity sweep happens once, at the end, via `filter` (never mid-loop
 * `splice` — design.md §6.4).
 * @module @/game/stepWorld
 */
import type { StepWorld } from '@/contracts';

import { applyCombat } from './systems/combat';
import { detectCollisions } from './systems/collision';
import { applyMovement } from './systems/movement';
import { applyProgression } from './systems/progression';
import { spawnTick } from './systems/spawner';
import { fireWeapon } from './systems/weapon';

export const stepWorld: StepWorld = (world, input, dt, rng): void => {
  if (world.session.status !== 'playing') {
    return;
  }

  fireWeapon(world, dt);
  applyMovement(world, input, dt);
  spawnTick(world, dt, rng);
  const collisions = detectCollisions(world);
  applyCombat(world, collisions, dt);
  applyProgression(world);

  world.enemies = world.enemies.filter((enemy) => enemy.alive);
  world.projectiles = world.projectiles.filter((projectile) => projectile.alive);
};
