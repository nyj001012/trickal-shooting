/**
 * The single sprite-replacement point (design.md §6.7). `RENDER_TABLE` is a
 * `Record<EntityKind, ...>`, so adding a new `EntityKind` to the contract without adding
 * a row here fails to compile — the render layer can never silently forget an entity
 * kind. Swapping to real art later means adding an `image` field to a descriptor and
 * branching on it here; `src/game/**` and `src/ui/**` stay untouched.
 * @module @/render/drawEntity
 */
import type { Entity, EntityKind } from '@/contracts';

import { PALETTE, type PaletteToken } from './palette';

interface RenderDescriptor {
  readonly shape: 'rect' | 'circle';
  readonly colorToken: PaletteToken;
}

const RENDER_TABLE: Readonly<Record<EntityKind, RenderDescriptor>> = {
  player: { shape: 'rect', colorToken: 'player' },
  enemy: { shape: 'circle', colorToken: 'enemy' },
  projectile: { shape: 'rect', colorToken: 'projectile' },
};

/**
 * Draws one entity. `hitFlash` overrides the descriptor's color for the current frame
 * only (used while `Player.invulnRemainSec > 0`, design.md §6.2.1-(5)); it never mutates
 * `entity` or any palette/table data.
 */
export function drawEntity(
  ctx: CanvasRenderingContext2D,
  entity: Readonly<Entity>,
  hitFlash = false,
): void {
  const descriptor = RENDER_TABLE[entity.kind];
  ctx.fillStyle = hitFlash ? PALETTE.hitFlash : PALETTE[descriptor.colorToken];

  if (descriptor.shape === 'rect') {
    ctx.fillRect(entity.x, entity.y, entity.width, entity.height);
    return;
  }

  const centerX = entity.x + entity.width / 2;
  const centerY = entity.y + entity.height / 2;
  const radius = Math.min(entity.width, entity.height) / 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
}
