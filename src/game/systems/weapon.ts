/**
 * Mutually-exclusive regular auto-fire and Space/MANA skill fire (D-2/D-3,
 * INV-FIRE-1, INV-MANA-1).
 * @module @/game/systems/weapon
 */
import type { FireWeapon, GameWorld, Rng } from '@/contracts';

import { BALANCE } from '../balance';

function tickCooldown(value: number, dt: number): number {
  const next = value - dt;
  return next <= Number.EPSILON ? 0 : next;
}

function clampMana(value: number): number {
  return Math.min(BALANCE.progression.manaMax, Math.max(0, value));
}

function fireRegularProjectile(world: GameWorld): void {
  const aliveCount = world.regularProjectiles.filter((projectile) => projectile.alive).length;
  if (aliveCount < BALANCE.limits.maxRegularProjectiles) {
    world.regularProjectiles.push({
      id: world.nextEntityId,
      kind: 'regularProjectile',
      alive: true,
      x: world.player.x + world.player.width,
      y: world.player.y + world.player.height / 2 - BALANCE.regularProjectile.height / 2,
      width: BALANCE.regularProjectile.width,
      height: BALANCE.regularProjectile.height,
      damage: BALANCE.regularProjectile.damage,
      lifetimeRemainSec: BALANCE.regularProjectile.lifetimeSec,
    });
    world.nextEntityId += 1;
  }
  world.player.regularFireCooldownRemainSec = BALANCE.player.regularFireCooldownSec;
}

function fireSkillProjectile(world: GameWorld, rng: Rng): void {
  const aliveCount = world.skillProjectiles.filter((projectile) => projectile.alive).length;
  if (aliveCount < BALANCE.limits.maxSkillProjectiles) {
    world.skillProjectiles.push({
      id: world.nextEntityId,
      kind: 'skillProjectile',
      alive: true,
      x: world.player.x + world.player.width,
      y: world.player.y + world.player.height / 2 - BALANCE.skillProjectile.height / 2,
      width: BALANCE.skillProjectile.width,
      height: BALANCE.skillProjectile.height,
      damage: BALANCE.skillProjectile.damage,
      lifetimeRemainSec: BALANCE.skillProjectile.lifetimeSec,
      vx: BALANCE.skillProjectile.speed,
      vy: (rng() - 0.5) * 2 * BALANCE.skillProjectile.initialSpreadSpeedY,
      turnFactor: BALANCE.skillProjectile.turnFactor,
    });
    world.nextEntityId += 1;
  }
  world.player.skillFireCooldownRemainSec = BALANCE.player.skillFireCooldownSec;
}

export const fireWeapon: FireWeapon = (world, input, dt, rng): void => {
  world.player.regularFireCooldownRemainSec = tickCooldown(
    world.player.regularFireCooldownRemainSec,
    dt,
  );
  world.player.skillFireCooldownRemainSec = tickCooldown(
    world.player.skillFireCooldownRemainSec,
    dt,
  );

  if (world.player.isSkillFiring) {
    if (!input.skill || world.session.mana <= 0) {
      world.player.isSkillFiring = false;
    }
  } else if (input.skill && world.session.mana >= BALANCE.player.skillStartMana) {
    world.player.isSkillFiring = true;
  }

  if (world.player.isSkillFiring) {
    world.session.mana = clampMana(world.session.mana - BALANCE.player.skillManaDrainPerSec * dt);
    if (world.player.skillFireCooldownRemainSec <= 0) {
      fireSkillProjectile(world, rng);
    }
    if (world.session.mana <= 0) {
      world.player.isSkillFiring = false;
    }
    return;
  }

  world.session.mana = clampMana(world.session.mana + BALANCE.player.manaRegenPerSec * dt);
  if (world.player.regularFireCooldownRemainSec <= 0) {
    fireRegularProjectile(world);
  }
};
