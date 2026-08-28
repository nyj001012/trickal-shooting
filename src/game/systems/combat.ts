/**
 * Applies regular hits, skill hits, and player contacts as independent combat paths.
 * @module @/game/systems/combat
 */
import type { ApplyCombat, Box, GameWorld, HealingItem, Rng } from '@/contracts';

import { BALANCE } from '../balance';

function maybeDropHealingItem(world: GameWorld, enemy: Readonly<Box>, rng: Rng): void {
  if (rng() < BALANCE.healingItem.dropChance) {
    const centerX = enemy.x + enemy.width / 2;
    const centerY = enemy.y + enemy.height / 2;
    const item: HealingItem = {
      id: world.nextEntityId++,
      kind: 'healingItem',
      alive: true,
      x: centerX - BALANCE.healingItem.width / 2,
      y: centerY - BALANCE.healingItem.height / 2,
      width: BALANCE.healingItem.width,
      height: BALANCE.healingItem.height,
      vx: BALANCE.healingItem.driftVx,
      vy: BALANCE.healingItem.fallVy,
    };
    world.healingItems.push(item);
  }
}

export const applyCombat: ApplyCombat = (world, collisions, dt, rng): void => {
  world.player.invulnRemainSec = Math.max(0, world.player.invulnRemainSec - dt);

  for (const hit of collisions.regularProjectileHits) {
    const enemy = world.enemies.find((candidate) => candidate.id === hit.enemy.id);
    const projectile = world.regularProjectiles.find(
      (candidate) => candidate.id === hit.projectile.id,
    );
    if (!enemy || !projectile || !enemy.alive || !projectile.alive) continue;

    enemy.hp -= projectile.damage;
    projectile.alive = false;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      world.session.score += enemy.scoreValue;
      world.session.mana = Math.min(
        BALANCE.progression.manaMax,
        Math.max(0, world.session.mana + enemy.manaGain),
      );
      maybeDropHealingItem(world, enemy, rng);
    }
  }

  for (const hit of collisions.skillProjectileHits) {
    const enemy = world.enemies.find((candidate) => candidate.id === hit.enemy.id);
    const projectile = world.skillProjectiles.find(
      (candidate) => candidate.id === hit.projectile.id,
    );
    if (!enemy || !projectile || !enemy.alive || !projectile.alive) continue;

    enemy.hp -= projectile.damage;
    projectile.alive = false;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      world.session.score += enemy.scoreValue;
      maybeDropHealingItem(world, enemy, rng);
    }
  }

  for (const contact of collisions.playerContacts) {
    const enemy = world.enemies.find((candidate) => candidate.id === contact.enemy.id);
    if (!enemy || !enemy.alive) continue;

    if (world.player.invulnRemainSec <= 0) {
      world.session.hp = Math.max(0, world.session.hp - enemy.contactDamage);
      world.player.invulnRemainSec = BALANCE.player.invulnSec;
    }
    enemy.alive = false;
  }

  for (const hit of collisions.enemyProjectileHits) {
    const projectile = world.enemyProjectiles.find(
      (candidate) => candidate.id === hit.projectile.id,
    );
    if (!projectile || !projectile.alive) continue;

    projectile.alive = false;
    if (world.player.invulnRemainSec <= 0) {
      world.session.hp = Math.max(0, world.session.hp - projectile.damage);
      world.player.invulnRemainSec = BALANCE.player.invulnSec;
    }
  }

  for (const pickup of collisions.playerItemPickups) {
    const item = world.healingItems.find((candidate) => candidate.id === pickup.item.id);
    if (!item || !item.alive) continue;

    if (world.session.hp < world.session.maxHp) {
      world.session.hp = Math.min(
        world.session.maxHp,
        world.session.hp + BALANCE.healingItem.healAmount,
      );
    } else {
      world.session.score += BALANCE.healingItem.fullHpBonusScore;
    }
    item.alive = false;
  }
};
