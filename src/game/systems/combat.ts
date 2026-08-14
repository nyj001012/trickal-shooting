/**
 * Applies collision results: invuln timer decays first, then projectile hits (damage,
 * death, score/mana), then player contacts (HP loss gated by invuln — INV-DMG-1).
 * @module @/game/systems/combat
 */
import type { ApplyCombat } from '@/contracts';

import { BALANCE } from '../balance';

export const applyCombat: ApplyCombat = (world, collisions, dt): void => {
  world.player.invulnRemainSec = Math.max(0, world.player.invulnRemainSec - dt);

  for (const hit of collisions.projectileHits) {
    const enemy = world.enemies.find((candidate) => candidate.id === hit.enemy.id);
    const projectile = world.projectiles.find((candidate) => candidate.id === hit.projectile.id);
    if (!enemy || !projectile || !enemy.alive || !projectile.alive) continue;

    enemy.hp -= projectile.damage;
    projectile.alive = false;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      world.session.score += enemy.scoreValue;
      world.session.mana += enemy.manaGain;
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
};
