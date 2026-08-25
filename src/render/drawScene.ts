/**
 * Draws one full frame. Reads `world` only (never mutates it — design.md §6.0 rule 2);
 * the `Readonly<GameWorld>` parameter type enforces this at the type level.
 * @module @/render/drawScene
 */
import type { GameWorld } from '@/contracts';

import { drawEntity } from './drawEntity';
import { PALETTE } from './palette';

/** Visual-only blink cadence while the player is inside the contact-damage grace period. */
const HIT_FLASH_INTERVAL_SEC = 0.1;

export function drawScene(ctx: CanvasRenderingContext2D, world: Readonly<GameWorld>): void {
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, world.bounds.width, world.bounds.height);

  const playerHitFlash =
    world.player.invulnRemainSec > 0 &&
    Math.floor(world.player.invulnRemainSec / HIT_FLASH_INTERVAL_SEC) % 2 === 0;
  drawEntity(ctx, world.player, playerHitFlash);

  for (const enemy of world.enemies) {
    drawEntity(ctx, enemy);
  }
  for (const projectile of world.regularProjectiles) {
    drawEntity(ctx, projectile);
  }
  for (const projectile of world.skillProjectiles) {
    drawEntity(ctx, projectile);
  }
  for (const projectile of world.enemyProjectiles) {
    drawEntity(ctx, projectile);
  }
}
